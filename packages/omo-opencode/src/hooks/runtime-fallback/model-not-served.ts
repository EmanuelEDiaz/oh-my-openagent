import { markModelBroken } from "../../shared/broken-models-cache"
import { classifyErrorType, getErrorMessage } from "./error-classifier"

/** `provider/model` from an event's `model` string/object or its `providerID` + `modelID` fields. */
export function modelFromEventInfo(info: Record<string, unknown> | undefined, normalized: string | undefined): string | undefined {
  if (normalized) return normalized
  const providerID = info?.["providerID"]
  const modelID = info?.["modelID"]
  return typeof providerID === "string" && typeof modelID === "string" ? `${providerID}/${modelID}` : undefined
}

/**
 * The provider answered that the model does not exist / has no route (fork plan real-use-incidents A2): remember it
 * for 24 h so the picker, model resolution and later fallbacks skip it. Returns whether the error was of that kind.
 */
export function recordIfModelNotServed(error: unknown, model: string | undefined): boolean {
  if (classifyErrorType(error) !== "model_not_found") return false
  if (model) markModelBroken(model, getErrorMessage(error))
  return true
}
