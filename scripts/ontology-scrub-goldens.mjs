import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { scrub } from '../lib/scrub.mjs'
assert.equal(process.version,'v24.22.2')
const source=readFileSync(new URL('../lib/scrub.mjs',import.meta.url))
assert.equal(createHash('sha256').update(source).digest('hex'),'9c9b1b233e2af96e3ef106e8c85d7efb94f06d3acd14d70a8959ee1c2990fb7a')
const a='A'.repeat(32), b='B'.repeat(24)
const inputs=[...['\u00a0','\ufeff','\v','\u0085','\u2028'].map(w=>'Bearer'+w+b),'_sk-'+a,'é sk-'+a,'\ud800😀sk-'+a+'\udfff😀','sk-ant-'+a,'Bearer eyJabcdef.abcdefgh.abcdefghijklmno','postgres://a:b@host/x','postgres://a:b@host\u00a0suffix','-----BEGIN PRIVATE KEY-----\ud800😀\n-----END PRIVATE KEY-----','AWS_SECRET_ACCESS_KEY\ufeff=\v'+a,
 'sk_test_'+a,'ghp_'+a,'xoxb-'+a,'AKIA'+'A'.repeat(16),'AIza'+'A'.repeat(35),'npm_'+'A'.repeat(36),'sk-ant-'+a+' sk-'+a,'xsk-'+a,'sk-'+a+'-tail','postgres://a:b@host\u0085tail','_ghp_'+a,'😀Bearer '+b+'\ud800','-----BEGIN RSA PRIVATE KEY-----a\r\nb-----END EC PRIVATE KEY-----']
const units=s=>Array.from({length:s.length},(_,i)=>s.charCodeAt(i))
const cases=inputs.map(input=>{const result=scrub(input);return {input:units(input),text:units(result.text),detections:result.detections}})
const output={node:process.version,source_sha256:createHash('sha256').update(source).digest('hex'),cases}
const path=new URL('../contracts/ontology/unicode-17/scrub-cases.json',import.meta.url)
if(process.argv[2]==='--write')writeFileSync(path,JSON.stringify(output,null,2)+'\n')
else assert.deepEqual(JSON.parse(readFileSync(path)),output)
