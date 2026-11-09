import { buildContextPack } from "../../src/domain/policies/build-context-pack.js";
import { describe, expect, it } from "vitest";
import type { SearchMemoryResult } from "../../src/domain/model/memory.js";
import { validateMemoryRevalidation } from "../../src/domain/policies/memory-revalidation.js";
import { describeMemoryRevalidation, memoryContentDigest, memoryRecordDigest, inspectMemoryImpact } from "../../src/application/tools/memory-revalidation.js";
const memory: SearchMemoryResult = { id:1, organizationId:"org", scopeType:"project",scopeId:"p",sourceId:3,memoryType:"fact",content:"Original",createdAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z",source:{id:3,scopeType:"project",scopeId:"p",sourceType:"document",title:null,uri:null,createdAt:"2026-01-01T00:00:00Z"}};
const digest = "a".repeat(64);
const recipe = {schemaVersion:1 as const,recheck:{method:"Read source",trigger:"Before reuse",boundContentDigest:digest},sourceObservations:[],dependencies:[],derivatives:[]};
describe("reported memory revalidation",()=>{
 it("renders the reported binding warning without treating recipes as instructions",()=>{
  const record={...memory,revalidation:recipe,revalidationBinding:{bindingMatchesRecord:false,sourceCurrentness:"unknown" as const,basis:"reported" as const}};
  const pack=buildContextPack({records:[record]});
  expect(pack.markdown).toContain("reported recheck; binding mismatch; source currentness unknown");
  expect(pack.markdown).not.toContain("Read source");
 });
 it("rejects executable fields, oversized metadata and secrets in refs",()=>{
  expect(()=>validateMemoryRevalidation({...recipe,recheck:{...recipe.recheck,command:"rm -rf /"}})).toThrow();
  expect(()=>validateMemoryRevalidation({...recipe,recheck:{...recipe.recheck,method:"x".repeat(5000)}})).toThrow();
  expect(()=>validateMemoryRevalidation({...recipe,sourceObservations:[{ref:"postgres://user:pass@host/db",digest}]})).toThrow();
  expect(validateMemoryRevalidation(recipe)).toEqual(recipe);
 });
 it("separates content binding from metadata and governance CAS state",()=>{
  const changed = {...memory,tags:["review"],durability:"archived" as const,importance:5};
  expect(memoryContentDigest(changed)).toBe(memoryContentDigest(memory));
  expect(memoryRecordDigest(changed)).not.toBe(memoryRecordDigest(memory));
  expect(memoryContentDigest({...memory,id:2})).not.toBe(memoryContentDigest(memory));
  expect(memoryRecordDigest({...memory,revalidation:recipe})).not.toBe(memoryRecordDigest(memory));
 });
 it("keeps reported basis and external currentness unknown after matching or stale binding",()=>{
  const revalidation={...recipe,recheck:{...recipe.recheck,boundContentDigest:memoryContentDigest(memory)}};
  expect(describeMemoryRevalidation({...memory,revalidation})).toMatchObject({bindingMatchesRecord:true,sourceCurrentness:"unknown",basis:"reported"});
  expect(describeMemoryRevalidation({...memory,revalidation,content:"Corrected"})).toMatchObject({bindingMatchesRecord:false,sourceCurrentness:"unknown"});
 });
 it("finds explicit memory and source dependents, cycles and registered derivative refs only",()=>{
  const second={...memory,id:2,revalidation:{...recipe,dependencies:[{memoryId:1,contentDigest:digest}],derivatives:[{kind:"wiki" as const,owner:"p",ref:"wiki:page",digest}]}};
  const third={...memory,id:3,revalidation:{...recipe,dependencies:[{memoryId:2,contentDigest:digest},{memoryId:1,contentDigest:digest}],sourceObservations:[{ref:"source:api",digest}]}};
  const result=inspectMemoryImpact({records:[{...memory,revalidation:{...recipe,dependencies:[{memoryId:3,contentDigest:digest}]}},second,third],changedMemoryIds:[1],changedSourceRefs:[],truncated:false});
  expect(result.affectedMemoryIds).toEqual([2,3]);
  expect(result.registeredDerivatives).toEqual([{memoryId:2,kind:"wiki",owner:"p",ref:"wiki:page",digest}]);
  expect(result).toMatchObject({coverage:"known_only",dependenciesComplete:false,registered_scan_complete:true,broader_review_required:true});
  expect(inspectMemoryImpact({records:[memory,second,third],changedMemoryIds:[],changedSourceRefs:["source:api"],truncated:true})).toMatchObject({affectedMemoryIds:[3],registered_scan_complete:false,truncated:true});
 });
 it("reports empty and unresolved scans without claiming safe reuse",()=>{
  const empty=inspectMemoryImpact({records:[],changedMemoryIds:[99],changedSourceRefs:["missing"],truncated:false});
  expect(empty).toMatchObject({affectedMemoryIds:[],unresolved_dependencies:2,dependenciesComplete:false,broader_review_required:true});
 });
 it("caps registered derivative output and marks the report incomplete",()=>{
  const derivatives=Array.from({length:64},(_,index)=>({kind:"wiki" as const,owner:"p",ref:`page:${index}`,digest}));
  const records=Array.from({length:16},(_,index)=>({...memory,id:index+2,revalidation:{...recipe,dependencies:[{memoryId:1,contentDigest:digest}],derivatives}}));
  const result=inspectMemoryImpact({records,changedMemoryIds:[1],changedSourceRefs:[],truncated:false});
  expect(result.registeredDerivatives).toHaveLength(1000);
  expect(result).toMatchObject({truncated:true,registered_scan_complete:false,broader_review_required:true});
 });

});
