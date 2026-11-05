export type ConfirmationOptions = { title?: string; confirmLabel?: string };
export type ConfirmationFrame = ConfirmationOptions & {
  readonly token: symbol;
  message: string;
};

/** A dialog token is local UI state, never a server request identifier. */
export class ConfirmationState {
  private pending: {
    frame: ConfirmationFrame;
    resolve: (accepted: boolean) => void;
  } | null = null;
  begin(message: string, options: ConfirmationOptions = {}) {
    this.cancel();
    const frame: ConfirmationFrame = {
      ...options,
      message,
      token: Symbol("confirmation"),
    };
    const promise = new Promise<boolean>((resolve) => {
      this.pending = { frame, resolve };
    });
    return { frame, promise };
  }
  settle(frame: ConfirmationFrame, accepted: boolean) {
    if (this.pending?.frame !== frame) return false;
    const pending = this.pending;
    this.pending = null;
    pending.resolve(accepted);
    return true;
  }
  cancel() {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(false);
  }
}
