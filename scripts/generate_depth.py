import os
import numpy as np
from PIL import Image
import onnxruntime as ort


def boxblur(t: np.ndarray, w: int, h: int, rad: int) -> np.ndarray:
    """2D separable box blur matching gather.be-of-dao.com's tt() helper."""
    a = np.zeros((h, w), dtype=np.float32)
    res = np.zeros((h, w), dtype=np.float32)
    for y in range(h):
        for x in range(w):
            a[y, x] = np.mean(t[y, max(0, x - rad):min(w, x + rad + 1)])
    for x in range(w):
        for y in range(h):
            res[y, x] = np.mean(a[max(0, y - rad):min(h, y + rad + 1), x])
    return res


def nt(arr: np.ndarray) -> np.ndarray:
    """1st-to-99th percentile normalization matching gather.be-of-dao.com's nt()."""
    p1 = np.percentile(arr, 1)
    p99 = np.percentile(arr, 99)
    return np.clip((arr - p1) / max(1e-6, p99 - p1), 0.0, 1.0)


def generate_depth(base_image_path: str, cutout_image_path: str, output_depth_path: str, fastdepth_model_path: str):
    print(f"Loading base image from {base_image_path} and cutout from {cutout_image_path}...")
    img_base = Image.open(base_image_path).convert('RGBA')
    img_cut = Image.open(cutout_image_path).convert('RGBA')
    orig_w, orig_h = img_base.size

    # Work at gather's internal grid resolution first for guided filter & luminance relief
    r = 1024
    scale = r / max(orig_w, orig_h)
    a_w = round(orig_w * scale)
    r_h = round(orig_h * scale)

    rgba = np.array(img_base.resize((a_w, r_h), Image.Resampling.BILINEAR)).astype(np.float32) / 255.0
    i_lum = 0.2126 * rgba[:, :, 0] + 0.7152 * rgba[:, :, 1] + 0.0722 * rgba[:, :, 2]

    # 1. Multi-scale luminance relief rt() from gather.be-of-dao.com
    rad_rt = max(2, round(max(a_w, r_h) / 36))
    r_rt = boxblur(boxblur(i_lum, a_w, r_h, rad_rt), a_w, r_h, rad_rt)
    near_rt = nt(0.7 * r_rt + 0.3 * i_lum)

    # 2. FastDepth 224x224 inference + Guided Image Filter it() from gather.be-of-dao.com
    d_img = img_base.convert('RGB').resize((224, 224), Image.Resampling.BILINEAR)
    inp = np.transpose(np.array(d_img).astype(np.float32) / 255.0, (2, 0, 1))[np.newaxis, :, :, :].astype(np.float32)
    sess = ort.InferenceSession(fastdepth_model_path, providers=['CPUExecutionProvider'])
    m_out = sess.run(None, {sess.get_inputs()[0].name: inp})[0].squeeze()
    e_near = 1.0 / np.maximum(0.05, m_out)

    # Suppress left-border conv padding ramp while preserving organic spatial wave
    for x in range(75):
        t_b = x / 75.0
        e_near[:, x] = e_near[:, 75] * (1.0 - t_b * 0.4) + e_near[:, 223 - x] * (t_b * 0.4)

    s = max(8, round(a_w / 4))
    l = max(8, round(r_h / 4))
    c = max(2, round(max(s, l) / 40))

    u_arr = np.array(Image.fromarray(i_lum).resize((s, l), Image.Resampling.BILINEAR))
    h_arr = nt(np.array(Image.fromarray(e_near).resize((s, l), Image.Resampling.BILINEAR)))
    p_arr = boxblur(u_arr, s, l, c)
    g_arr = boxblur(h_arr, s, l, c)
    y_arr = boxblur(u_arr * u_arr, s, l, c)
    x_arr = boxblur(u_arr * h_arr, s, l, c)

    w_coeff = (x_arr - p_arr * g_arr) / (y_arr - p_arr * p_arr + 0.0015)
    v_coeff = g_arr - w_coeff * p_arr
    M = np.array(Image.fromarray(boxblur(w_coeff, s, l, c)).resize((a_w, r_h), Image.Resampling.BILINEAR))
    B = np.array(Image.fromarray(boxblur(v_coeff, s, l, c)).resize((a_w, r_h), Image.Resampling.BILINEAR))
    near_it = nt(M * i_lum + B)

    # 3. Blend 0.65 * near_it + 0.35 * near_rt (exact gather.be-of-dao.com formula on foreground)
    near_base = 0.65 * near_it + 0.35 * near_rt

    cut_small = np.array(img_cut.split()[3].resize((a_w, r_h), Image.Resampling.BILINEAR)).astype(np.float32) / 255.0
    bg_weight = 1.0 - np.clip(cut_small * 1.25, 0.0, 1.0)

    yy, xx = np.mgrid[0:r_h, 0:a_w]
    ux = xx / a_w
    uy = 1.0 - yy / r_h
    chin_loop = 0.14 * np.exp(-((uy - 0.33) / 0.095) ** 2) * np.exp(-((ux - 0.5) / 0.45) ** 2)
    ribbon_wave = (
        0.048 * np.sin(uy * 17.5 + 0.4) +
        0.028 * np.cos(uy * 32.0 - 1.1) +
        0.022 * np.sin(uy * 9.5 + ux * 6.0) +
        chin_loop
    ) * np.clip((near_base - 0.28) / 0.45, 0.0, 1.0) * bg_weight
    near_final = np.clip(near_base + ribbon_wave, 0.0, 1.0)

    # Edge gradient map (matching gather's _[a] = min(1, 3.5 * hypot(dx, dy)))
    gx = np.zeros_like(i_lum)
    gy = np.zeros_like(i_lum)
    gx[:, 1:-1] = i_lum[:, 2:] - i_lum[:, :-2]
    gy[1:-1, :] = i_lum[2:, :] - i_lum[:-2, :]
    edge_grad = np.clip(3.5 * np.hypot(gx, gy), 0.0, 1.0)

    # Upsample to original dimensions
    depth_u8 = np.array(
        Image.fromarray((near_final * 255.0).astype(np.uint8)).resize((orig_w, orig_h), Image.Resampling.BICUBIC)
    )
    it_u8 = np.array(
        Image.fromarray((near_it * 255.0).astype(np.uint8)).resize((orig_w, orig_h), Image.Resampling.BICUBIC)
    )
    edge_u8 = np.array(
        Image.fromarray((edge_grad * 255.0).astype(np.uint8)).resize((orig_w, orig_h), Image.Resampling.BILINEAR)
    )
    cut_alpha = np.array(img_cut.split()[3])

    out_rgba = np.stack([depth_u8, it_u8, edge_u8, cut_alpha], axis=-1)
    Image.fromarray(out_rgba, mode='RGBA').save(output_depth_path)
    print(f"Saved non-linear guided depth map to {output_depth_path} successfully!")


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    client_dir = os.path.dirname(script_dir)
    base_p = os.path.join(client_dir, 'public', 'portrait-base.png')
    cut_p = os.path.join(client_dir, 'public', 'portrait-base-cutout.png')
    out_p = os.path.join(client_dir, 'public', 'portrait-depth.png')
    model_p = os.path.join(script_dir, 'models', 'fastdepth.onnx')
    generate_depth(base_p, cut_p, out_p, model_p)
