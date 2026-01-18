import os from 'os';

let previousCpuInfo = null;

export function getCpuUsagePercent() {
    const cpus = os.cpus();

    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    }

    const currentCpuInfo = {
        idle: totalIdle,
        total: totalTick
    };

    let cpuPercent = 0;

    if (previousCpuInfo) {
        const idleDiff = currentCpuInfo.idle - previousCpuInfo.idle;
        const totalDiff = currentCpuInfo.total - previousCpuInfo.total;

        if (totalDiff > 0) {
            cpuPercent = 100 - (100 * idleDiff / totalDiff);
        }
    }

    previousCpuInfo = currentCpuInfo;

    return `${cpuPercent.toFixed(1)}%`;
}
