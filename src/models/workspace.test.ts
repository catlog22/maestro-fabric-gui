import { describe, expect, it } from "vitest";
import { emptyWorkspaceTopology, replaceWorkspacePage, selectWorkspace, workspaceHealth, type WorkspaceTopology } from "./workspace";
const state: WorkspaceTopology = { profileId:"p", selectedId:undefined, cursor:0, hasMore:false, revision:0, records:[{layer:"registry",id:"w1",path:"D:/a",mode:"lease",generation:2,expiresAt:100,status:"active"}] };
describe("workspace topology",()=>{
 it("distinguishes expired registry leases",()=>expect(workspaceHealth(state.records[0]!,200)).toBe("expired"));
 it("does not select an unknown workspace",()=>expect(selectWorkspace(state,"missing")).toBe(state));
 it("accepts cursor pages and increments revision",()=>expect(replaceWorkspacePage(state,{records:[],nextCursor:3,hasMore:true})).toMatchObject({cursor:3,hasMore:true,revision:1}));
});
