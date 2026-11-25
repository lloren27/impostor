const metricNames = ["errors", "rejections", "redis_conflicts", "reconnections"] as const;
type MetricName = (typeof metricNames)[number];

const counters: Record<MetricName, number> = {
  errors: 0,
  rejections: 0,
  redis_conflicts: 0,
  reconnections: 0,
};

export function recordMetric(name: MetricName): void {
  counters[name]++;
}

export function flushMetrics(): void {
  const snapshot = Object.fromEntries(
    Object.entries(counters).filter(([, count]) => count > 0),
  );
  if (Object.keys(snapshot).length === 0) return;

  for (const name of metricNames) counters[name] = 0;
  console.info(JSON.stringify({
    event: "operational_metrics",
    intervalSeconds: 60,
    timestamp: new Date().toISOString(),
    counters: snapshot,
  }));
}

const metricsTimer = setInterval(flushMetrics, 60_000);
metricsTimer.unref();
process.once("beforeExit", flushMetrics);