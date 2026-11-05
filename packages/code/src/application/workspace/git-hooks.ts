import { resolve } from "node:path";
import { DEFAULT_HOOKS, hookTemplate, MANAGED_MARKER } from "../../domain/workspace/git-hooks.js";
import type { ParallaxGitHookAction, ParallaxGitHookOptions, ParallaxGitHookPlan } from "../../domain/workspace/git-hooks.js";
import type { GitHookPorts } from "./setup-ports.js";

export function planParallaxGitHooks(options: ParallaxGitHookOptions, ports: GitHookPorts): ParallaxGitHookPlan {
  const repoRoot = resolve(options.repoRoot);
  ports.assertGitRepo(repoRoot);
  const hooks = options.hooks ?? DEFAULT_HOOKS;
  const planned = hooks.map((hook) => {
    const path = ports.hookPath(repoRoot, hook);
    const existingContent = ports.readHook(path);
    const exists = existingContent !== null;
    const existing = existingContent ?? '';
    const managed = existing.includes(MANAGED_MARKER);
    const action: ParallaxGitHookAction = exists
      ? (managed || options.force ? 'overwrite' : 'skip')
      : 'create';
    return {
      hook,
      path,
      action,
      content: hookTemplate(hook, {
        command: options.command ?? 'parallax',
        failOn: options.failOn ?? 'proven'
      })
    };
  });
  return { repoRoot, hooks: planned };
}

export function installParallaxGitHooks(options: ParallaxGitHookOptions, ports: GitHookPorts): ParallaxGitHookPlan {
  const plan = planParallaxGitHooks(options, ports);
  for (const hook of plan.hooks) {
    if (hook.action === 'skip') continue;
    ports.writeHook(hook.path, hook.content);
  }
  return plan;
}