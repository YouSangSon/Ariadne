package oauth

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	_ "crypto/sha256" // registers crypto.SHA256
	_ "crypto/sha512" // registers crypto.SHA384 and crypto.SHA512
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"strconv"
	"strings"
	"unicode/utf8"
)

// This file follows jose 6.2.13 as Node 24 runs it (lib/jws_verify.js, lib/validate.js, jwks/local.js, lib/key.js).

type signatureScheme uint8

const (
	pkcs1v15 signatureScheme = iota + 1
	pss
	ecdsaRaw
	eddsa
)

// algorithm is a jose JWS table entry. HMAC and ML-DSA are absent: they fail like unknown algorithms.
type algorithm struct {
	kty    string
	crv    string
	hash   crypto.Hash
	scheme signatureScheme
}

var algorithms = map[string]algorithm{
	"RS256":   {kty: "RSA", hash: crypto.SHA256, scheme: pkcs1v15},
	"RS384":   {kty: "RSA", hash: crypto.SHA384, scheme: pkcs1v15},
	"RS512":   {kty: "RSA", hash: crypto.SHA512, scheme: pkcs1v15},
	"PS256":   {kty: "RSA", hash: crypto.SHA256, scheme: pss},
	"PS384":   {kty: "RSA", hash: crypto.SHA384, scheme: pss},
	"PS512":   {kty: "RSA", hash: crypto.SHA512, scheme: pss},
	"ES256":   {kty: "EC", crv: "P-256", hash: crypto.SHA256, scheme: ecdsaRaw},
	"ES384":   {kty: "EC", crv: "P-384", hash: crypto.SHA384, scheme: ecdsaRaw},
	"ES512":   {kty: "EC", crv: "P-521", hash: crypto.SHA512, scheme: ecdsaRaw},
	"EdDSA":   {kty: "OKP", crv: "Ed25519", scheme: eddsa},
	"Ed25519": {kty: "OKP", crv: "Ed25519", scheme: eddsa},
}

var curves = map[string]elliptic.Curve{"P-256": elliptic.P256(), "P-384": elliptic.P384(), "P-521": elliptic.P521()}

const minRSABits = 2048

var utf8BOM = []byte{0xef, 0xbb, 0xbf}

// decodeBase64URL is jose's atob fallback: '+' and '/' fail, ASCII whitespace is ignored, and a length
// divisible by four may end in one or two '=' pad characters.
func decodeBase64URL(value string) ([]byte, bool) {
	if strings.ContainsAny(value, "+/") {
		return nil, false
	}
	value = strings.Map(func(r rune) rune {
		switch r {
		case '-':
			return '+'
		case '_':
			return '/'
		case '\t', '\n', '\f', '\r', ' ':
			return -1
		}
		return r
	}, value)
	if len(value)%4 == 0 {
		value = strings.TrimSuffix(strings.TrimSuffix(value, "="), "=")
	}
	decoded, err := base64.RawStdEncoding.DecodeString(value)
	return decoded, err == nil
}

// decodeSegment parses a JOSE header or claims segment: fatal UTF-8 with one leading BOM dropped, then
// one top-level JSON object. Numbers stay json.Number so 1e400 can become +Inf as in JavaScript.
func decodeSegment(segment string) (map[string]any, bool) {
	data, ok := decodeBase64URL(segment)
	if !ok || !utf8.Valid(data) {
		return nil, false
	}
	decoder := json.NewDecoder(bytes.NewReader(bytes.TrimPrefix(data, utf8BOM)))
	decoder.UseNumber()
	var object map[string]any
	if decoder.Decode(&object) != nil || object == nil {
		return nil, false
	}
	_, err := decoder.Token()
	return object, errors.Is(err, io.EOF)
}

// jsNumber converts a decoded JSON number the way JavaScript does, overflowing to ±Inf.
func jsNumber(value any) (float64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	parsed, err := strconv.ParseFloat(string(number), 64)
	return parsed, err == nil || errors.Is(err, strconv.ErrRange)
}

// checkCrit applies jose's crit rules, where "b64" is the only recognized extension, and returns b64.
func checkCrit(header map[string]any) (bool, bool) {
	raw, present := header["crit"]
	if !present {
		return true, true
	}
	crit, ok := raw.([]any)
	if !ok || len(crit) == 0 {
		return false, false
	}
	for _, parameter := range crit {
		if parameter != "b64" {
			return false, false
		}
	}
	b64, ok := header["b64"].(bool)
	return b64, ok
}

// usableJWK is jose's isUsableJWK filter for one JWK Set member.
func usableJWK(jwk map[string]any, entry algorithm, alg string, header map[string]any) bool {
	if ext, present := jwk["ext"]; present {
		if _, ok := ext.(bool); !ok {
			return false
		}
	}
	if raw, present := jwk["key_ops"]; present && !verifyOps(raw) {
		return false
	}
	if kid, present := header["kid"]; present {
		if text, ok := kid.(string); !ok || jwk["kid"] != text {
			return false
		}
	}
	if jwkAlg, present := jwk["alg"]; present && jwkAlg != alg {
		return false
	}
	if use, present := jwk["use"]; present && use != "sig" {
		return false
	}
	return jwk["kty"] == entry.kty && (entry.crv == "" || jwk["crv"] == entry.crv)
}

// verifyOps holds for an array of unique strings that includes "verify".
func verifyOps(raw any) bool {
	ops, ok := raw.([]any)
	if !ok {
		return false
	}
	seen := map[string]bool{}
	for _, op := range ops {
		text, ok := op.(string)
		if !ok || seen[text] {
			return false
		}
		seen[text] = true
	}
	return seen["verify"]
}

// importPublicKey is WebCrypto's JWK import of a public verification key plus jose's modulus check.
func importPublicKey(jwk map[string]any, entry algorithm) (crypto.PublicKey, bool) {
	_, hasD := jwk["d"]
	_, hasPriv := jwk["priv"]
	if hasD || hasPriv {
		return nil, false // a private JWK imports as a private key, which jose refuses
	}
	// WebCrypto refuses any usage but "verify" for a public key, and usableJWK already required "verify".
	if ops, ok := jwk["key_ops"].([]any); ok && len(ops) != 1 {
		return nil, false
	}
	switch entry.kty {
	case "RSA":
		if _, multiPrime := jwk["oth"]; multiPrime {
			return nil, false // WebCrypto refuses any oth member, even an empty or null one
		}
		n, okN := jwkBytes(jwk, "n")
		e, okE := jwkBytes(jwk, "e")
		exponent := new(big.Int).SetBytes(e)
		modulus := new(big.Int).SetBytes(n)
		if !okN || !okE || !exponent.IsInt64() || modulus.BitLen() < minRSABits {
			return nil, false
		}
		return &rsa.PublicKey{N: modulus, E: int(exponent.Int64())}, true
	case "EC":
		x, okX := jwkBytes(jwk, "x")
		y, okY := jwkBytes(jwk, "y")
		curve := curves[entry.crv]
		size := (curve.Params().BitSize + 7) / 8
		if !okX || !okY || len(x) != size || len(y) != size {
			return nil, false
		}
		key, err := ecdsa.ParseUncompressedPublicKey(curve, append(append([]byte{4}, x...), y...))
		return key, err == nil
	default: // OKP with crv Ed25519
		x, ok := jwkBytes(jwk, "x")
		if !ok || len(x) != ed25519.PublicKeySize {
			return nil, false
		}
		return ed25519.PublicKey(x), true
	}
}

// jwkBytes decodes a base64url key member; shortcut: unpadded or padded base64url only, unlike Node's lenient decoder.
func jwkBytes(jwk map[string]any, member string) ([]byte, bool) {
	text, ok := jwk[member].(string)
	if !ok {
		return nil, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(text, "="))
	return decoded, err == nil
}

func verifySignature(entry algorithm, key crypto.PublicKey, input, signature []byte) bool {
	if entry.scheme == eddsa {
		return ed25519.Verify(key.(ed25519.PublicKey), input, signature)
	}
	digest := entry.hash.New()
	digest.Write(input)
	sum := digest.Sum(nil)
	switch entry.scheme {
	case pkcs1v15:
		return rsa.VerifyPKCS1v15(key.(*rsa.PublicKey), entry.hash, sum, signature) == nil
	case pss:
		return rsa.VerifyPSS(key.(*rsa.PublicKey), entry.hash, sum, signature, &rsa.PSSOptions{SaltLength: rsa.PSSSaltLengthEqualsHash}) == nil
	}
	public := key.(*ecdsa.PublicKey)
	size := (public.Curve.Params().BitSize + 7) / 8
	if len(signature) != 2*size {
		return false // WebCrypto takes only the raw r||s form
	}
	r := new(big.Int).SetBytes(signature[:size])
	s := new(big.Int).SetBytes(signature[size:])
	return ecdsa.Verify(public, sum, r, s)
}
