import type { BrowserViewPick } from "@pen.dev/sdk";
import { Emitter } from "../chat/lib/emitter";

export interface BrowserPickerState {
  pick: BrowserViewPick | undefined;
}

export interface BrowserApi {
  navigate: (url: string) => void;
  pick: () => void;
  select: (selector: string) => Promise<boolean>;
  selectPath: (index: number) => void;
  hover: (selector: string | null) => void;
  hoverPath: (index: number | null) => void;
  import: () => void;
  onPicker: (callback: (state: BrowserPickerState | undefined) => void) => void;
  onStatus: (callback: (text: string) => void) => void;
}

export const browserApi = (): BrowserApi =>
  (window as unknown as { demo: { browser: BrowserApi } }).demo.browser;

class BrowserPane {
  readonly emitter = new Emitter();

  private _picker: BrowserPickerState | undefined;
  private _status = "Pick an element, or enter a selector.";

  get picker(): BrowserPickerState | undefined {
    return this._picker;
  }

  get status(): string {
    return this._status;
  }

  init(): void {
    browserApi().onPicker((state) => {
      this._picker = state;
      if (!state) {
        this._status = "Pick an element, or enter a selector.";
      } else if (state.pick) {
        this._status = "Enter in the page imports the selection.";
      } else {
        this._status = "Click an element in the page. Escape cancels.";
      }
      this.emitter.emit();
    });
    browserApi().onStatus((text) => {
      this._status = text;
      this.emitter.emit();
    });
  }
}

export const browser = new BrowserPane();
