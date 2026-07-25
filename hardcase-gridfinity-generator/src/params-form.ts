import type { ModelDef, ParamDef, ParamValues } from "./models";

/** Render a single param input (text, number, or checkbox). */
function renderParam(
  param: ParamDef,
  values: Record<string, unknown>,
  onChange: () => void,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "field";

  const caption = document.createElement("span");
  caption.textContent = param.label;
  if (param.unit) {
    const unit = document.createElement("em");
    unit.className = "unit";
    unit.textContent = `(${param.unit})`;
    caption.appendChild(unit);
  }

  if (param.type === "boolean") {
    label.className = "field checkbox-field";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = param.key;
    input.checked = Boolean(values[param.key] ?? param.default);
    input.addEventListener("change", () => {
      values[param.key] = input.checked;
      onChange();
    });
    const cap = document.createElement("span");
    cap.className = "checkbox-label";
    cap.textContent = param.label;
    label.append(input, cap);
    return label;
  }

  if (param.type === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.name = param.key;
    input.value = String(values[param.key] ?? param.default);
    input.addEventListener("input", () => {
      values[param.key] = input.value;
      onChange();
    });
    label.append(caption, input);
    return label;
  }

  // default: number
  const input = document.createElement("input");
  input.type = "number";
  input.name = param.key;
  input.value = String(values[param.key]);
  if (param.min !== undefined) input.min = String(param.min);
  if (param.max !== undefined) input.max = String(param.max);
  if (param.step !== undefined) input.step = String(param.step);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    values[param.key] = v;
    onChange();
  });
  label.append(caption, input);
  return label;
}

export function renderParamsForm(
  form: HTMLFormElement,
  model: ModelDef,
  values: ParamValues,
  onChange: (values: ParamValues) => void,
): void {
  const vals = values as Record<string, unknown>;
  const paramMap = new Map(model.params.map((p) => [p.key, p]));
  const presets = model.presets ?? [];
  // The label of the preset currently applied (empty = "— Custom —"). Tracked
  // across re-renders so the dropdown keeps showing the chosen preset.
  let selectedPreset = "";
  let presetSelect: HTMLSelectElement | null = null;

  // A hand edit means the values no longer match a named preset, so drop the
  // dropdown back to "— Custom —" (without a full re-render — that would steal
  // focus mid-keystroke) and rebuild the model.
  const onEdit = () => {
    if (selectedPreset && presetSelect) {
      selectedPreset = "";
      presetSelect.value = "";
    }
    onChange({ ...values });
  };

  const render = () => {
    form.innerHTML = "";
    const grouped = new Set<string>();

    // Presets dropdown (above sections)
    if (presets.length > 0) {
      const presetLabel = document.createElement("label");
      presetLabel.className = "field";
      const caption = document.createElement("span");
      caption.textContent = "Preset";
      const select = document.createElement("select");
      select.name = "preset";
      // Default option
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "— Custom —";
      select.appendChild(noneOpt);
      for (const preset of presets) {
        const opt = document.createElement("option");
        opt.value = preset.label;
        opt.textContent = preset.label;
        select.appendChild(opt);
      }
      select.value = selectedPreset;
      select.addEventListener("change", () => {
        const preset = presets.find((p) => p.label === select.value);
        if (!preset) return;
        selectedPreset = preset.label;
        for (const [key, val] of Object.entries(preset.values)) {
          vals[key] = val;
        }
        render(); // refresh the inputs so they show the preset's values…
        onChange({ ...values }); // …and rebuild the model
      });
      presetSelect = select;
      presetLabel.append(caption, select);
      form.appendChild(presetLabel);
    }

    // Render groups in order
    if (model.groups) {
      for (const group of model.groups) {
        const section = document.createElement("details");
        section.className = "param-group";
        section.open = !group.collapsed;

        const summary = document.createElement("summary");
        summary.className = "param-group-title";
        summary.textContent = group.title;
        section.appendChild(summary);

        const body = document.createElement("div");
        body.className = "param-group-body";
        for (const key of group.keys) {
          const param = paramMap.get(key);
          if (param) {
            body.appendChild(renderParam(param, vals, onEdit));
            grouped.add(key);
          }
        }
        section.appendChild(body);
        form.appendChild(section);
      }
    }

    // Render any params not in a group at the top
    for (const param of model.params) {
      if (!grouped.has(param.key)) {
        form.appendChild(renderParam(param, vals, onEdit));
      }
    }
  };

  render();
}
