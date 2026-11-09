import { requiredScopeKindForTool } from "../../src/interfaces/http/middleware/oauth-token-auth.js";
import { describe,expect,it } from "vitest";
import { validateToolInput } from "../../src/interfaces/mcp/tool-schemas.js";
const revalidation={schemaVersion:1,recheck:{method:"Read source",trigger:"Before reuse",boundContentDigest:"a".repeat(64)}};
describe("revalidation transport contracts",()=>{
 it("classifies impact as read and metadata edits as admin",()=>{
  expect(requiredScopeKindForTool("inspect_memory_impact",{})).toBe("read");
  expect(requiredScopeKindForTool("update_memory",{revalidation:null})).toBe("admin");
 });
 it("requires optimistic concurrency for adding or removing metadata",()=>{
  expect(validateToolInput("update_memory",{memoryId:1,revalidation}).ok).toBe(false);
  expect(validateToolInput("update_memory",{memoryId:1,revalidation:null}).ok).toBe(false);
  expect(validateToolInput("update_memory",{memoryId:1,revalidation,expectedRecordDigest:"b".repeat(64)}).ok).toBe(true);
 });
});
