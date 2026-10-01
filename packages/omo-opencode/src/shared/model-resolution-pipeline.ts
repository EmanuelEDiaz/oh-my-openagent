import {
  _setModelResolutionLogImplementationForTesting,
  resolveModelPipeline as resolveModelPipelineFromCore,
} from "@oh-my-opencode/model-core"
import type {
  PipelineModelResolutionRequest,
  PipelineModelResolutionResult,
} from "@oh-my-opencode/model-core"
import * as connectedProvidersCache from "./connected-providers-cache"
import { paidModelCheck } from "./free-model-preference"

export { _setModelResolutionLogImplementationForTesting }

export function resolveModelPipeline(
  request: PipelineModelResolutionRequest,
): PipelineModelResolutionResult | undefined {
  const isPaidModel = request.policy?.isPaidModel ?? paidModelCheck()
  const withPreference = isPaidModel ? { ...request, policy: { ...request.policy, isPaidModel } } : request
  return resolveModelPipelineFromCore(withPreference, connectedProvidersCache)
}
export type {
  PipelineModelResolutionRequest as ModelResolutionRequest,
  PipelineModelResolutionProvenance as ModelResolutionProvenance,
  PipelineModelResolutionResult as ModelResolutionResult,
} from "@oh-my-opencode/model-core"
