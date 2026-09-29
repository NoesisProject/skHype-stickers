import { html, Component } from "../lib/htm/preact.js";
import * as widgetAPI from "./widget-api.js?v=20260929-gif-migration-v2";

const STORAGE_KEY = "skHypeGifMigrationV1";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function emptyProgress(packId) {
  return { version: 1, packId, results: {}, errors: {} };
}

function loadProgress(packId) {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (data?.version === 1 && data?.packId === packId) {
      return {
        version: 1,
        packId,
        results: data.results || {},
        errors: data.errors || {},
      };
    }
  } catch (error) {
    console.warn("[skHype migration] Unable to read saved progress:", error);
  }
  return emptyProgress(packId);
}

function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function isGif(sticker) {
  return sticker?.info?.mimetype === "image/gif" &&
    /^https?:\/\//.test(sticker?.thumbnail_url || "");
}

function alreadyMigrated(sticker) {
  return sticker?.url?.startsWith("mxc://") &&
    sticker?.info?.["org.matrix.msc4230.is_animated"] === true;
}

function applyResults(pack, progress) {
  const output = JSON.parse(JSON.stringify(pack));
  for (const sticker of output.stickers) {
    const result = progress.results[sticker.id];
    if (!result) continue;
    sticker.url = result.url;
    sticker.info = {
      ...(sticker.info || {}),
      size: result.size,
      mimetype: "image/gif",
      "org.matrix.msc4230.is_animated": true,
    };
  }
  return output;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class GifMigrationPanel extends Component {
  constructor(props) {
    super(props);
    this.progress = loadProgress(props.pack.id);
    this.running = false;
    this.pauseRequested = false;
    this.state = {
      status: "idle",
      current: "",
      message: "",
      completed: this.countCompleted(props.pack, this.progress),
      errorCount: Object.keys(this.progress.errors).length,
    };
  }

  getGifStickers(pack = this.props.pack) {
    return pack.stickers.filter(isGif);
  }

  countCompleted(pack, progress = this.progress) {
    return this.getGifStickers(pack).filter(
      sticker => alreadyMigrated(sticker) || !!progress.results[sticker.id]
    ).length;
  }

  startMigration = async () => {
    if (this.running) return;
    this.running = true;
    this.pauseRequested = false;

    this.setState({
      status: "connecting",
      message: "Connecting to Element Desktop…",
      current: "",
    });

    try {
      await widgetAPI.waitForReady(8000);
    } catch (error) {
      this.running = false;
      this.setState({
        status: "error",
        message: error?.message || String(error),
      });
      return;
    }

    const stickers = this.getGifStickers();
    this.setState({
      status: "running",
      message: "Uploading animated GIFs to Matrix…",
    });

    for (const sticker of stickers) {
      if (this.pauseRequested) {
        this.running = false;
        this.setState({
          status: "paused",
          current: "",
          message: "Paused. Progress is saved locally.",
        });
        return;
      }

      if (alreadyMigrated(sticker) || this.progress.results[sticker.id]) {
        this.setState({
          completed: this.countCompleted(this.props.pack),
          errorCount: Object.keys(this.progress.errors).length,
        });
        continue;
      }

      this.setState({ current: sticker.body });

      try {
        const response = await fetch(sticker.thumbnail_url, { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading ${sticker.body}`);
        }

        const blob = await response.blob();
        const gifBlob = blob.type === "image/gif"
          ? blob
          : blob.slice(0, blob.size, "image/gif");

        const mxc = await widgetAPI.uploadFile(gifBlob);

        this.progress.results[sticker.id] = {
          url: mxc,
          size: gifBlob.size,
          body: sticker.body,
        };
        delete this.progress.errors[sticker.id];
        saveProgress(this.progress);

        this.setState({
          completed: this.countCompleted(this.props.pack),
          errorCount: Object.keys(this.progress.errors).length,
          message: `Uploaded ${sticker.body}`,
        });
      } catch (error) {
        console.error("[skHype migration] Failed:", sticker.body, error);
        this.progress.errors[sticker.id] = {
          body: sticker.body,
          message: error?.message || String(error),
        };
        saveProgress(this.progress);

        this.setState({
          errorCount: Object.keys(this.progress.errors).length,
          message: `Failed: ${sticker.body}`,
        });
      }

      await delay(150);
    }

    this.running = false;
    const errorCount = Object.keys(this.progress.errors).length;
    const completed = this.countCompleted(this.props.pack);

    this.setState({
      status: errorCount ? "done-errors" : "done",
      current: "",
      completed,
      errorCount,
      message: errorCount
        ? `Finished with ${errorCount} failed sticker(s). You can export now; failed sticker(s) will keep their old MXC.`
        : "Migration complete. Your JSON is ready.",
    });
  };

  pauseMigration = () => {
    if (!this.running) return;
    this.pauseRequested = true;
    this.setState({ message: "Pausing after the current upload…" });
  };

  resetMigration = () => {
    if (!window.confirm("Reset saved GIF migration progress? Uploaded Matrix media will not be deleted.")) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    this.progress = emptyProgress(this.props.pack.id);
    this.running = false;
    this.pauseRequested = false;
    this.setState({
      status: "idle",
      current: "",
      message: "Migration cache reset.",
      completed: this.countCompleted(this.props.pack),
      errorCount: 0,
    });
  };

  getOutputJson() {
    return JSON.stringify(applyResults(this.props.pack, this.progress), null, 2) + "\n";
  }

  downloadJson = () => {
    downloadText(`${this.props.pack.id}-animated.json`, this.getOutputJson());
  };

  copyJson = async () => {
    try {
      await navigator.clipboard.writeText(this.getOutputJson());
      this.setState({ message: "JSON copied to clipboard." });
    } catch (error) {
      this.setState({ message: "Clipboard copy failed. Use Download JSON instead." });
    }
  };

  render() {
    const total = this.getGifStickers().length;
    const processed = this.state.completed + this.state.errorCount;
    const exportReady = processed >= total && this.state.completed > 0;
    const running = this.state.status === "running" || this.state.status === "connecting";
    const percent = total ? Math.round((this.state.completed / total) * 100) : 0;
    const failedItems = Object.values(this.progress.errors || {});

    return html`
      <div class="gif-migration">
        <h2>Animated GIF migration</h2>
        <p class="migration-note">
          Run this from Element Desktop. Progress is saved automatically, so you can resume later.
        </p>

        <div class="migration-progress">
          <div class="migration-progress-bar">
            <span style=${{ width: `${percent}%` }}></span>
          </div>
          <strong>${this.state.completed} / ${total}</strong>
          ${this.state.errorCount
            ? html`<span class="migration-errors"> · ${this.state.errorCount} failed</span>`
            : null}
        </div>

        ${this.state.current
          ? html`<p class="migration-current">Uploading: ${this.state.current}</p>`
          : null}

        ${this.state.message
          ? html`<p class="migration-message">${this.state.message}</p>`
          : null}

        ${failedItems.length
          ? html`
              <div class="migration-failures">
                <strong>Failed sticker(s):</strong>
                <ul>
                  ${failedItems.map(
                    item => html`<li><code>${item.body}</code> — ${item.message}</li>`
                  )}
                </ul>
              </div>
            `
          : null}

        <div class="migration-buttons">
          <button disabled=${running} onClick=${this.startMigration}>
            ${this.state.completed > 0 ? "Resume / retry migration" : "Start GIF migration"}
          </button>
          <button disabled=${!running} onClick=${this.pauseMigration}>Pause</button>
          <button disabled=${!exportReady} onClick=${this.downloadJson}>Download JSON</button>
          <button disabled=${!exportReady} onClick=${this.copyJson}>Copy JSON</button>
          <button disabled=${running} onClick=${this.resetMigration}>Reset migration cache</button>
        </div>
      </div>
    `;
  }
}
