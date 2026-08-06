import type { VisibilityRule, VisibilityRuleGroup, VisibilityRuleSet } from "@/types";

function evaluateRule(rule: VisibilityRule, attributes: Record<string, unknown>): boolean {
  const raw = attributes[rule.field];
  const isMultiOp = rule.op === "in" || rule.op === "not_in";

  if (isMultiOp) {
    const ruleVals = Array.isArray(rule.value)
      ? rule.value.map(String)
      : String(rule.value ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);

    if (Array.isArray(raw)) {
      const fieldArr = (raw as unknown[]).map(String);
      return rule.op === "in"
        ? fieldArr.some((v) => ruleVals.includes(v))
        : !fieldArr.some((v) => ruleVals.includes(v));
    }
    const fieldStr = String(raw ?? "");
    return rule.op === "in" ? ruleVals.includes(fieldStr) : !ruleVals.includes(fieldStr);
  }

  // eq / neq — compare as strings; handle multiple_select array fields
  const ruleVal = String(rule.value ?? "");
  if (Array.isArray(raw)) {
    const fieldArr = (raw as unknown[]).map(String);
    return rule.op === "eq" ? fieldArr.includes(ruleVal) : !fieldArr.includes(ruleVal);
  }
  const fieldStr = String(raw ?? "");
  return rule.op === "eq" ? fieldStr === ruleVal : fieldStr !== ruleVal;
}

function evaluateGroup(group: VisibilityRuleGroup, attributes: Record<string, unknown>): boolean {
  const active = group.rules.filter((r) => r.field);
  if (!active.length) return false;
  const results = active.map((r) => evaluateRule(r, attributes));
  return group.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** Returns true when the rule set is satisfied (item should be hidden). */
export function evaluateRuleSet(
  ruleSet: VisibilityRuleSet | undefined,
  attributes: Record<string, unknown>,
): boolean {
  if (!ruleSet) return false;
  const activeGroups = ruleSet.groups.filter((g) => g.rules.some((r) => r.field));
  if (!activeGroups.length) return false;
  const results = activeGroups.map((g) => evaluateGroup(g, attributes));
  return ruleSet.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** True when the rule set has at least one configured (non-empty) rule. */
export function hasActiveRules(ruleSet: VisibilityRuleSet | undefined): boolean {
  return !!ruleSet?.groups.some((g) => g.rules.some((r) => r.field));
}
