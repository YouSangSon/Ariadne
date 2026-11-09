import { prepareClientAbExperiment as prepare } from "../../application/evaluation/prepare-experiment.js";
import { seedAndPreflightClientAb as preflight, runClientAb as run } from "../../application/evaluation/run-client-ab.js";
import { createClientEvaluationPorts, createEvaluationCorpusSource } from "../../infrastructure/evaluation/client-ab.js";
export function prepareClientAbExperiment(input: Parameters<typeof prepare>[0]) { return prepare(input, createEvaluationCorpusSource(input.repoDir)); }
export function seedAndPreflightClientAb(input: Parameters<typeof preflight>[0]) { return preflight(input, createClientEvaluationPorts()); }
export function runClientAb(input: Parameters<typeof run>[0]) { return run(input, createClientEvaluationPorts()); }
