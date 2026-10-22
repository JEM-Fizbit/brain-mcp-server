import fs from "node:fs/promises";
import { loadRegistry } from "./registry.js";
import { WritePolicyError, validateWritePolicy, type BrainWritePolicy } from "./write-policy.js";
export async function writePolicyForBrain(brainId: string): Promise<BrainWritePolicy | undefined> {
    const registry = await loadRegistry();
    let policy = registry.brains.find(b => b.id === brainId)?.write_policy;
    const policyFile = process.env.BRAIN_WRITE_POLICY_CONFIG;
    if (policyFile) {
        let config: any;
        try {
            config = JSON.parse(await fs.readFile(policyFile, "utf8"));
        }
        catch {
            throw new WritePolicyError("policy_unavailable", brainId, "The deployment policy file is unavailable; no legacy fallback is permitted.");
        }
        if (config.version !== 1 || !Array.isArray(config.brains) || config.brains.filter((b: any) => b.id === brainId).length !== 1) {
            throw new WritePolicyError("policy_unavailable", brainId, "The selected Brain needs exactly one deployment-owned policy.");
        }
        policy = config.brains.find((b: any) => b.id === brainId).write_policy;
    }
    try {
        validateWritePolicy(policy);
    }
    catch {
        throw new WritePolicyError("policy_unavailable", brainId, "The configured write policy is invalid; no legacy fallback is permitted.");
    }
    const required = (process.env.BRAIN_REQUIRED_WRITE_POLICY || "").split(",").map(s => s.trim());
    if ((policyFile || required.includes(brainId)) && !policy)
        throw new WritePolicyError("policy_unavailable", brainId, "The selected deployment requires write_policy; no legacy fallback is permitted.");
    return policy;
}
