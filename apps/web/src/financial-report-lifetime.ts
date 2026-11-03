/** Only the visible, current session may display late report reads or receipts. */
export class ReportLifetime {
  private generation = 0;
  private live = false;
  private controllers = new Set<AbortController>();
  private displayed: () => boolean;
  private visible: () => boolean;
  constructor(displayed: () => boolean, visible: () => boolean) {
    this.displayed = displayed;
    this.visible = visible;
  }
  resume(active: boolean) {
    this.live = active;
    ++this.generation;
  }
  pause() {
    this.live = false;
    ++this.generation;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
  begin() {
    if (!this.live || !this.displayed() || !this.visible()) return null;
    const controller = new AbortController(),
      generation = this.generation;
    this.controllers.add(controller);
    return {
      signal: controller.signal,
      current: () =>
        this.live &&
        this.displayed() &&
        this.visible() &&
        generation === this.generation &&
        !controller.signal.aborted,
      finish: () => this.controllers.delete(controller),
    };
  }
}
export function reportScope(session: {
  instance_id: string;
  user: { id: string; role: string };
  receipt_scope: string;
}) {
  return JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
}
export const reportStorageKey = (scope: string) =>
  "alcor.report-operation:" + scope;
