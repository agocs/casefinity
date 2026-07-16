import "./style.css";
import { wrap } from "comlink";
import type { Remote } from "comlink";
import { models, modelById, defaultValues } from "./models";
import type { ParamValues } from "./models";
import type { CadWorkerApi } from "./worker";
import { Viewer } from "./viewer";
import { renderParamsForm } from "./params-form";

const worker = wrap<CadWorkerApi>(
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
) as Remote<CadWorkerApi>;

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

let currentModelId = models[0].id;
let currentValues: ParamValues = defaultValues(models[0]);
let buildToken = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

async function rebuild(): Promise<void> {
  const token = ++buildToken;
  spinner.classList.add("active");
  setStatus("building…");
  const started = performance.now();
  try {
    const meshes = await worker.mesh(currentModelId, currentValues);
    if (token !== buildToken) return; // superseded by a newer request
    viewer.update(meshes);
    setStatus(`built in ${Math.round(performance.now() - started)} ms`);
  } catch (error) {
    if (token !== buildToken) return;
    setStatus(`build failed: ${error instanceof Error ? error.message : error}`, true);
  } finally {
    if (token === buildToken) spinner.classList.remove("active");
  }
}

function scheduleRebuild(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(rebuild, 300);
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

async function exportModel(kind: "stl" | "step" | "3mf"): Promise<void> {
  for (const b of exportButtons) b.disabled = true;
  setStatus(`exporting ${kind.toUpperCase()}…`);
  try {
    const blob =
      kind === "stl"
        ? await worker.exportSTL(currentModelId, currentValues)
        : kind === "step"
          ? await worker.exportSTEP(currentModelId, currentValues)
          : await worker.export3MF(currentModelId, currentValues);
    download(blob, `${currentModelId}.${kind}`);
    setStatus(`${kind.toUpperCase()} exported`);
  } catch (error) {
    setStatus(`export failed: ${error instanceof Error ? error.message : error}`, true);
  } finally {
    for (const b of exportButtons) b.disabled = false;
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
