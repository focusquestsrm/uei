const ATTRIBUTION_KEYS = ["fbclid", "_fbc", "_fbp"];

export function collectAttribution(search) {
  const parameters = new URLSearchParams(search);
  return Object.fromEntries(
    ATTRIBUTION_KEYS.flatMap((key) => {
      const value = parameters.get(key)?.trim().slice(0, 512);
      return value ? [[key, value]] : [];
    })
  );
}
