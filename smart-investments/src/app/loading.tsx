export default function Loading() {
  return (
    <div className="card flex items-center gap-4">
      <div className="spinner" />
      <div>
        <div className="font-semibold">Pulling county records…</div>
        <div className="muted text-sm">Live lookups from Miami-Dade open data usually take 2–10 seconds.</div>
      </div>
    </div>
  );
}
