export const loadConversationWorkspace = () =>
  import("@/pages/conversation-workspace").then((module) => ({
    default: module.ConversationWorkspace,
  }))

export const loadInteractiveApplicationPage = () =>
  import("./interactive-application-page").then((module) => ({
    default: module.InteractiveApplicationPage,
  }))

export function preloadApplicationDestination(interactive: boolean): void {
  // Speculative loading shares the browser's module cache with React.lazy.
  // The mounted route still owns loading errors; this never creates a task.
  void (
    interactive ? loadInteractiveApplicationPage() : loadConversationWorkspace()
  ).catch(() => undefined)
}
