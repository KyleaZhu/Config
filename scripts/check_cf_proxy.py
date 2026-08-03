import re
import socket
import ssl
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed


# ========================= 扫描配置 =========================

TIMEOUT = 1.5
MAX_WORKERS = 200

# 第一步 TLS 探测时使用的 SNI
TLS_DOMAIN = "www.cloudflare.com"

# 第二步 TLS 握手的 SNI，以及 HTTP 请求的 Host
HTTP_DOMAIN = "crypto.cloudflare.com"

# 第三步使用自己托管在 Cloudflare 上的域名验证证书
CUSTOM_DOMAIN = "gcp.xdu.qzz.io"

# 输入、输出文件
IP_FILE = "ip.txt"
BESTIP_FILE = "bestip.txt"


def load_ip_list(file_path: str) -> list[str]:
    """从文件读取 IP，每行一个；忽略空行和 # 注释。"""
    with open(file_path, "r", encoding="utf-8") as file:
        ip_list = []
        for line in file:
            ip = line.split("#", 1)[0].strip()
            if ip:
                ip_list.append(ip)
        return ip_list


def create_tls_connection(
    ip: str,
    server_name: str,
    timeout: float = TIMEOUT,
) -> ssl.SSLSocket:
    """连接 IP:443 并完成 TLS 握手。"""
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    sock = socket.create_connection((ip, 443), timeout=timeout)
    try:
        tls_sock = context.wrap_socket(sock, server_hostname=server_name)
    except Exception:
        sock.close()
        raise

    tls_sock.settimeout(timeout)
    return tls_sock


# ========================= 第一步：TCP + TLS 探测 =========================


def probe_tls(ip: str) -> bool:
    """通过 TCP + TLS 探测 IP，并检查 www.cloudflare.com 的证书。"""
    try:
        with create_tls_connection(ip, TLS_DOMAIN) as tls_sock:
            certificate = tls_sock.getpeercert(binary_form=True)
            return bool(certificate and b"cloudflare" in certificate.lower())
    except (OSError, ssl.SSLError):
        return False


def scan_tls_batch(ip_list: list[str]) -> list[str]:
    """并发执行第一步，返回 TLS 证书探测通过的 IP。"""
    tls_ips = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(probe_tls, ip): ip
            for ip in ip_list
        }

        for future in as_completed(futures):
            ip = futures[future]
            try:
                if future.result():
                    tls_ips.append(ip)
                    print(f"[TLS] 保留 IP: {ip}")
            except Exception:
                pass

    return tls_ips


# ========================= 第二步：HTTP 301 验证 =========================


def probe_http_301(ip: str) -> bool:
    """使用 crypto.cloudflare.com 作为 TLS SNI 和 HTTP Host，严格检查 301。"""
    try:
        with create_tls_connection(ip, HTTP_DOMAIN) as tls_sock:
            request = (
                "GET / HTTP/1.1\r\n"
                f"Host: {HTTP_DOMAIN}\r\n"
                "User-Agent: Mozilla/5.0\r\n"
                "Connection: close\r\n"
                "\r\n"
            ).encode("ascii")
            tls_sock.sendall(request)

            response = b""
            while b"\r\n" not in response and len(response) < 8192:
                chunk = tls_sock.recv(1024)
                if not chunk:
                    break
                response += chunk

            status_line = response.decode("ascii", errors="ignore").split(
                "\r\n", 1
            )[0]
            match = re.match(r"HTTP/\d\.\d\s+(\d{3})(?:\s|$)", status_line)
            return bool(match and match.group(1) == "301")
    except (OSError, ssl.SSLError):
        return False


def scan_http_batch(tls_ips: list[str]) -> list[str]:
    """并发执行第二步，返回 HTTP 状态码为 301 的有效 IP。"""
    valid_ips = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(probe_http_301, ip): ip
            for ip in tls_ips
        }

        for future in as_completed(futures):
            ip = futures[future]
            try:
                if future.result():
                    valid_ips.append(ip)
                    print(f"[HTTP 301] 有效 IP: {ip}")
            except Exception:
                pass

    return valid_ips


# ========================= 第三步：自定义域名证书验证 =========================


def certificate_matches_custom_domain(tls_sock: ssl.SSLSocket) -> bool:
    """检查 TLS 返回证书的 CN 或 SAN 是否包含自定义域名。"""
    certificate = tls_sock.getpeercert(binary_form=True)
    if not certificate:
        return False

    certificate_file = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".pem",
        encoding="ascii",
        delete=False,
    )
    try:
        certificate_file.write(ssl.DER_cert_to_PEM_cert(certificate))
        certificate_file.close()
        decoded = ssl._ssl._test_decode_cert(certificate_file.name)
    finally:
        certificate_file.close()
        import os
        os.unlink(certificate_file.name)

    names = {
        value.lower()
        for name, value in decoded.get("subjectAltName", ())
        if name == "DNS"
    }
    names.update(
        value.lower()
        for group in decoded.get("subject", ())
        for name, value in group
        if name == "commonName"
    )
    return CUSTOM_DOMAIN.lower() in names


def probe_custom_domain(ip: str) -> bool:
    """使用自定义域名作为 TLS SNI，确认返回证书包含该域名。"""
    try:
        with create_tls_connection(ip, CUSTOM_DOMAIN) as tls_sock:
            return certificate_matches_custom_domain(tls_sock)
    except (OSError, ssl.SSLError, ValueError):
        return False


def scan_custom_domain_batch(http_ips: list[str]) -> list[str]:
    """并发执行第三步，返回证书匹配自定义域名的 IP。"""
    valid_ips = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(probe_custom_domain, ip): ip
            for ip in http_ips
        }

        for future in as_completed(futures):
            ip = futures[future]
            try:
                if future.result():
                    valid_ips.append(ip)
                    print(f"[CUSTOM TLS] 证书匹配 {CUSTOM_DOMAIN}: {ip}")
            except Exception:
                pass

    return valid_ips


# ========================= 第四步：保存有效 IP =========================


def save_best_ips(ip_list: list[str], file_path: str) -> None:
    """将有效 IP 保存到 bestip.txt，每行一个并覆盖旧结果。"""
    unique_ips = sorted(set(ip_list))
    with open(file_path, "w", encoding="utf-8", newline="\n") as file:
        for ip in unique_ips:
            file.write(f"{ip}\n")


# ========================= 主流程：三步执行 =========================


def main() -> None:
    ip_list = load_ip_list(IP_FILE)
    print(f"开始扫描 {len(ip_list)} 个 IP...\n")

    # 第一步：TCP + TLS 探测，保留 Cloudflare 证书对应的 IP。
    tls_ips = scan_tls_batch(ip_list)
    print(f"\n第一步完成，保留 {len(tls_ips)} 个 IP。")

    # 第二步：TLS SNI 和 HTTP Host 均使用 crypto.cloudflare.com，严格要求返回 301。
    http_ips = scan_http_batch(tls_ips)
    print(f"第二步完成，得到 {len(http_ips)} 个 IP。")

    # 第三步：使用自定义域名 SNI，确认返回证书包含 gcp.xdu.qzz.io。
    valid_ips = scan_custom_domain_batch(http_ips)
    print(f"第三步完成，得到 {len(valid_ips)} 个有效 IP。")

    # 第四步：将最终有效 IP 保存到 bestip.txt。
    save_best_ips(valid_ips, BESTIP_FILE)
    print(f"第四步完成，已保存到 {BESTIP_FILE}。")


if __name__ == "__main__":
    main()