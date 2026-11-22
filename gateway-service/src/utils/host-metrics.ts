/**
 * The main server's own disk and memory, read by the gateway at each scrape (no node_exporter on
 * the main server). Alerts: disk above 85 %, memory above 90 % (Security plan item 11).
 *   sbc_host_memory_total_bytes, sbc_host_memory_available_bytes   (/proc/meminfo MemAvailable)
 *   sbc_host_disk_total_bytes{path}, sbc_host_disk_free_bytes{path} (METRICS_DISK_PATHS, default /)
 *   sbc_host_load1
 */
import fs from 'fs';
import os from 'os';
import client from 'prom-client';
import { registry } from './metrics';

function memAvailable(): number {
    try {
        const m = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
        if (m) return Number(m[1]) * 1024;
    } catch { /* not Linux */ }
    return os.freemem();
}

const paths = (process.env.METRICS_DISK_PATHS || '/').split(',').map((p) => p.trim()).filter(Boolean).slice(0, 5);

new client.Gauge({ name: 'sbc_host_memory_total_bytes', help: 'Host memory', registers: [registry], collect() { this.set(os.totalmem()); } });
new client.Gauge({ name: 'sbc_host_memory_available_bytes', help: 'Host memory available (MemAvailable)', registers: [registry], collect() { this.set(memAvailable()); } });
new client.Gauge({ name: 'sbc_host_load1', help: 'Host load average, 1 min', registers: [registry], collect() { this.set(os.loadavg()[0]); } });

const statfs = (fs as any).statfsSync as ((p: string) => { blocks: number; bsize: number; bavail: number }) | undefined;
new client.Gauge({
    name: 'sbc_host_disk_total_bytes', help: 'Disk size', labelNames: ['path'], registers: [registry],
    collect() { for (const p of paths) { try { const s = statfs?.(p); if (s) this.set({ path: p }, s.blocks * s.bsize); } catch { /* path gone */ } } },
});
new client.Gauge({
    name: 'sbc_host_disk_free_bytes', help: 'Disk space available to the service user', labelNames: ['path'], registers: [registry],
    collect() { for (const p of paths) { try { const s = statfs?.(p); if (s) this.set({ path: p }, s.bavail * s.bsize); } catch { /* path gone */ } } },
});
