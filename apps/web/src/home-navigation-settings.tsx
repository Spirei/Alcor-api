import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { FormActions, ToggleSwitch } from "./workspace-forms";
type Item = { key: string; label: string; href: string; enabled: boolean };
export function HomeNavigationSettings({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  let items: Item[];
  try {
    const parsed = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (item) =>
          !item ||
          typeof item.key !== "string" ||
          typeof item.label !== "string" ||
          typeof item.href !== "string" ||
          typeof item.enabled !== "boolean",
      )
    )
      throw new Error();
    items = parsed;
  } catch {
    return <p role="alert">导航内容暂不能显示，请在高级资料中核对原配置。</p>;
  }
  const write = (next: Item[]) => onChange(JSON.stringify(next, null, 2));
  const change = (index: number, patch: Partial<Item>) =>
    write(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  function move(index: number, delta: number) {
    const next = [...items],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    write(next);
  }
  return (
    <section className="site-navigation-editor" aria-label="首页导航">
      <h3>首页导航</h3>
      {items.length ? (
        <ol>
          {items.map((item, index) => (
            <li key={item.key}>
              <span className="site-order-number">{index + 1}</span>
              <div className="site-navigation-fields">
                <label className="workspace-form-field">
                  <span>名称</span>
                  <input
                    aria-label={`导航 ${index + 1} 名称`}
                    value={item.label}
                    maxLength={80}
                    disabled={disabled}
                    onChange={(event) =>
                      change(index, { label: event.target.value })
                    }
                  />
                </label>
                <label className="workspace-form-field">
                  <span>站内地址</span>
                  <input
                    aria-label={`导航 ${index + 1} 地址`}
                    value={item.href}
                    maxLength={512}
                    disabled={disabled}
                    onChange={(event) =>
                      change(index, { href: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="site-order-actions">
                <ToggleSwitch
                  label={`显示导航 ${index + 1}`}
                  checked={item.enabled}
                  disabled={disabled}
                  onChange={(enabled) => change(index, { enabled })}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`上移导航 ${index + 1}`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`下移导航 ${index + 1}`}
                  disabled={disabled || index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除导航 ${index + 1}`}
                  disabled={disabled}
                  onClick={() => write(items.filter((_, i) => i !== index))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="site-empty-note">暂未添加首页导航</p>
      )}
      <FormActions>
        <button
          type="button"
          className="button"
          disabled={disabled || items.length >= 20}
          onClick={() => {
            let n = 1;
            while (items.some((item) => item.key === `nav-${n}`)) n++;
            write([
              ...items,
              { key: `nav-${n}`, label: "新导航", href: "/", enabled: true },
            ]);
          }}
        >
          <Plus size={15} aria-hidden="true" />
          添加导航
        </button>
      </FormActions>
    </section>
  );
}
