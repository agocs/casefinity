import "./style.css";
import { wrap } from "comlink";
import type { Remote } from "comlink";
import { models, modelById, defaultValues } from "./models";
import type { ParamValues } from "./models";
import type { CadWorkerApi } from "./worker";
import { Viewer } from "./viewer";
import { renderParamsForm } from "./params-form";
import { CadSession, Cancelled } from "./cad-session.ts";
import type { ExportKind, WorkerHandle } from "./cad-session.ts";

const select = document.getElementById("model-select") as HTMLSelectElement;
const description = document.getElementById("model-description")!;
const form = document.getElementById("params-form") as HTMLFormElement;
const status = document.getElementById("status")!;
const stlButton = document.getElementById("download-stl") as HTMLButtonElement;
const stepButton = document.getElementById("download-step") as HTMLButtonElement;
const threeMfButton = document.getElementById("download-3mf") as HTMLButtonElement;
const exportButtons = [stlButton, stepButton, threeMfButton];
const viewer = new Viewer(document.getElementById("viewport")!);
const spinner = document.getElementById("spinner")!;

/** Spawn a real OCCT worker. Called again each time a build is preempted. */
function spawnWorker(): WorkerHandle {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  return {
    api: wrap<CadWorkerApi>(worker) as Remote<CadWorkerApi>,
    terminate: () => worker.terminate(),
  };
}

const session = new CadSession(spawnWorker);

// One sink for every piece of busy-state UI: the spinner and the export
// buttons. index.html already ships the idle state (no `active` class, no
// `disabled`), which is what the session assumes at construction.
session.onBusyChange = (busy) => {
  spinner.classList.toggle("active", busy);
  for (const b of exportButtons) b.disabled = busy;
};

let currentModelId = models[0].id;
let currentValues: ParamValues = defaultValues(models[0]);
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
// Wait this long after the last parameter edit before rebuilding, so dragging a
// slider or typing a value doesn't kick off a (potentially multi-second) build
// on every keystroke — only once the input has settled.
const REBUILD_DEBOUNCE_MS = 2000;

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

async function rebuild(): Promise<void> {
  setStatus(session.exporting ? "queued behind export…" : "building…");
  const started = performance.now();
  try {
    const meshes = await session.build(currentModelId, currentValues);
    viewer.update(meshes);
    setStatus(`built in ${Math.round(performance.now() - started)} ms`);
  } catch (error) {
    // A newer build has already taken over the status line and the spinner.
    if (error instanceof Cancelled) return;
    setStatus(`build failed: ${error instanceof Error ? error.message : error}`, true);
  }
}

function scheduleRebuild(): void {
  clearTimeout(debounceTimer);
  setStatus("waiting for edits to settle…");
  debounceTimer = setTimeout(rebuild, REBUILD_DEBOUNCE_MS);
}

function selectModel(id: string): void {
  currentModelId = id;
  const model = modelById(id);
  currentValues = defaultValues(model);
  description.textContent = model.description;
  renderParamsForm(form, model, currentValues, (values) => {
    currentValues = values;
    scheduleRebuild();
  });
  void rebuild();
}

function download(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function exportModel(kind: ExportKind): Promise<void> {
  setStatus(`exporting ${kind.toUpperCase()}…`);
  try {
    const blob = await session.exportModel(kind, currentModelId, currentValues);
    download(blob, `${currentModelId}.${kind}`);
    setStatus(`${kind.toUpperCase()} exported`);
  } catch (error) {
    setStatus(`export failed: ${error instanceof Error ? error.message : error}`, true);
  }
}

for (const model of models) {
  const option = document.createElement("option");
  option.value = model.id;
  option.textContent = model.name;
  select.appendChild(option);
}
select.addEventListener("change", () => selectModel(select.value));
stlButton.addEventListener("click", () => void exportModel("stl"));
stepButton.addEventListener("click", () => void exportModel("step"));
threeMfButton.addEventListener("click", () => void exportModel("3mf"));

// About page toggle
const aboutPanel = document.getElementById("about-panel")!;
const mainForm = document.getElementById("params-form")!;
const aboutLink = document.getElementById("nav-about")!;
const aboutClose = document.getElementById("about-close")!;
const modelField = document.getElementById("model-select")!.closest(".field")! as HTMLElement;
const actionsBox = document.getElementById("actions")!;

function showAbout(show: boolean): void {
  aboutPanel.hidden = !show;
  mainForm.hidden = show;
  description.hidden = show;
  modelField.hidden = show;
  actionsBox.hidden = show;
}

aboutLink.addEventListener("click", (e) => { e.preventDefault(); showAbout(true); });
aboutClose.addEventListener("click", (e) => { e.preventDefault(); showAbout(false); });

selectModel(currentModelId);
