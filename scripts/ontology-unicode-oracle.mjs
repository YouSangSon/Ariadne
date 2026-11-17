// Reproduce the public-data conformance and scalar hashes with the frozen Node oracle.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
assert.deepEqual([process.version,process.versions.icu,process.versions.unicode],['v24.22.2','78.3','17.0'])
const lower=createHash('sha256'),properties=createHash('sha256'),frame=Buffer.alloc(4),flag=Buffer.alloc(1)
for(let scalar=0;scalar<=0x10ffff;scalar++) {
 if(scalar>=0xd800&&scalar<=0xdfff)continue
 const text=String.fromCodePoint(scalar),mapped=Buffer.from(text.toLowerCase())
 frame.writeUInt32BE(mapped.length);lower.update(frame);lower.update(mapped)
 flag[0]=(+/\p{Cased}/u.test(text))|(+/\p{Case_Ignorable}/u.test(text)<<1);properties.update(flag)
}
assert.equal(lower.digest('hex'),'9128cbd760037a58f7a2ecd9d7b88d04ef999a0ac8d557667c4dcf22a0e60257')
assert.equal(properties.digest('hex'),'d0cd426457a02c5ba0189b2cc0b35ee4fbc97dc068ad7286cf2f76d053c18202')
const data=readFileSync(new URL('../contracts/ontology/unicode-17/NormalizationTest.txt',import.meta.url))
assert.equal(createHash('sha256').update(data).digest('hex'),'5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db')
const parse=value=>String.fromCodePoint(...value.trim().split(/\s+/).map(code=>parseInt(code,16)))
let rows=0,checks=0
for(const raw of data.toString().split('\n')) {
 const line=raw.split('#')[0].trim();if(!line||line.startsWith('@'))continue
 const fields=line.split(';'),target=parse(fields[3]);rows++
 for(let i=0;i<5;i++){assert.equal(parse(fields[i]).normalize('NFKC'),target,`row ${rows}, column ${i}`);checks++}
}
assert.equal(rows,20034);assert.equal(checks,100170)
console.log('Node Unicode17: 1112064 scalar hashes and 100170 normalization checks passed')
