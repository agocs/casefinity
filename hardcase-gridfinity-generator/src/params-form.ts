import type { ModelDef, ParamValues } from "./models";

export function renderParamsForm(
  form: HTMLFormElement,
  model: ModelDef,
  values: ParamValues,
  onChange: (values: ParamValues) => void,
): void {
  form.innerHTML = "";
  for (const param of model.params) {
    if (param.type === "boolean") {
      const label = document.createElement("label");
      label.className = "field checkbox-field";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = param.key;
      input.checked = Boolean(
        (values as Record<string, unknown>)[param.key] ?? param.default,
      );

      input.addEventListener("change", () => {
        (values as Record<string, unknown>)[param.key] = input.checked;
        onChange({ ...values });
      });

      const caption = document.createElement("span");
      caption.className = "checkbox-label";
      caption.textContent = param.label;

      label.append(input, caption);
      form.appendChild(label);
      continue;
    }

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

    if (param.type === "text") {
      const input = document.createElement("input");
      input.type = "text";
      input.name = param.key;
      input.value = String((values as Record<string, unknown>)[param.key] ?? param.default);

      input.addEventListener("input", () => {
        (values as Record<string, unknown>)[param.key] = input.value;
        onChange({ ...values });
      });

      label.append(caption, input);
      form.appendChild(label);
    } else {
      const input = document.createElement("input");
      input.type = "number";
      input.name = param.key;
      input.value = String(values[param.key]);
      if (param.min !== undefined) input.min = String(param.min);
      if (param.max !== undefined) input.max = String(param.max);
      if (param.step !== undefined) input.step = String(param.step);

      input.addEventListener("input", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        values[param.key] = value;
        onChange({ ...values });
      });

      label.append(caption, input);
      form.appendChild(label);
    }
  }
}