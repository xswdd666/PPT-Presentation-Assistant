import type { ButtonHTMLAttributes } from "react";
export async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
  key?: string,
): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? {}
      : {
          method,
          headers: {
            "content-type": "application/json",
            "idempotency-key": key ?? crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
  );
  const data: unknown = await response.json();
  if (!response.ok) throw new Error((data as { error: string }).error);
  return data as T;
}
export function Button({
  children,
  primary = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      {...props}
      className={`button ${primary ? "primary" : ""} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
