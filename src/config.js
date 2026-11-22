function parsePort(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return fallback;
  return n;
}

export const config = {
  port: parsePort(process.env.PORT, 3000),
};
