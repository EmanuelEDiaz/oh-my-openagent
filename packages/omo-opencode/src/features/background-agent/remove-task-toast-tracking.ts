import { getTaskToastManager } from "../task-toast-manager"

export function removeTaskToastTracking(taskId: string, directory?: string): void {
  const toastManager = getTaskToastManager(directory)
  if (toastManager) {
    toastManager.removeTask(taskId)
  }
}
