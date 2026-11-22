import { config } from '../config';

/**
 * Hosting, cloud and VPN networks (autonomous system numbers). A member's
 * request from one of these comes from a server, a VPN or a proxy, not from a
 * phone on a mobile network or a home connection. The list is short on purpose
 * (the big clouds and the networks commercial VPNs rent): a false "datacenter"
 * costs a member points. Add more with RISK_DATACENTER_ASNS.
 * Cloudflare WARP (13335) is left out on purpose: it is a free phone app many members use.
 * Tor: Cloudflare marks it as country T1, which the gateway records as an unknown
 * country, so it is not seen here; block it at Cloudflare if needed.
 */
const BUILT_IN = [
    16509, 14618, 8987, // Amazon AWS
    15169, 396982, 19527, // Google Cloud
    8075, 8068, // Microsoft Azure
    14061, // DigitalOcean
    16276, // OVH
    24940, 213230, // Hetzner
    63949, // Linode / Akamai cloud
    20473, // Vultr / Choopa
    51167, // Contabo
    60781, 28753, // Leaseweb
    9009, // M247 (many commercial VPNs)
    212238, 60068, // Datacamp / CDN77 (VPN exits)
    136787, // TEFINCOM (NordVPN)
    209854, // Surfshark
    46562, // Performive
    62240, // Clouvider
    32613, // iWeb
    45102, // Alibaba Cloud
    132203, // Tencent Cloud
    31898, // Oracle Cloud
];

let cached: Set<number> | null = null;
export function datacenterAsns(): Set<number> {
    if (!cached) cached = new Set([...BUILT_IN, ...config.live.extraDatacenterAsns]);
    return cached;
}
