export type WednesdayStatus = "ready" | "thinking" | "error";

export type WednesdayEvent =
  | { type: "status"; value: WednesdayStatus }
  | { type: "assistant.delta"; delta: string }
  | { type: "thinking.delta"; delta: string }
  | { type: "assistant.done" }
  | { type: "notice"; message: string }
  | { type: "tool.start"; name: string }
  | { type: "tool.end"; name: string; isError: boolean }
  | { type: "error"; message: string }
  | { type: "model.changed"; provider: string; id: string };

export type WednesdayEventListener = (event: WednesdayEvent) => void;

export class WednesdayEventBus {
  private listeners = new Set<WednesdayEventListener>();

  subscribe(listener: WednesdayEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: WednesdayEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
