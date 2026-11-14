// Tide Pool: light rippling over a shallow pool, in the pack's four colours.
// A code shader pack: helpers first, then shade. See docs/PACKS.md, "Shader packs with code".

float caustic(float2 p, float t) {
    float total = 0.0;
    float2 q = p;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        q += float2(sin(q.y * 1.7 + t * 0.6 + fi), cos(q.x * 1.3 - t * 0.5 + fi * 1.9)) * 0.35;
        total += 1.0 / (1.0 + 18.0 * abs(sin(q.x + q.y + t * 0.2)));
    }
    return total / 5.0;
}

float4 shade(float2 uv, constant Uniforms &u, texture2d<float> wallpaper) {
    float aspect = u.resolution.x / max(u.resolution.y, 1.0);
    float2 p = (uv - 0.5) * float2(aspect, 1.0) * 3.2 / u.scale;
    float t = u.time;

    // The pointer stirs the water: rings run out from it while it rests on the desktop.
    float2 hand = (u.pointer - 0.5) * float2(aspect, 1.0) * 3.2;
    float d = length(p - hand);
    p += normalize(p - hand + 0.0001) * sin(d * 9.0 - t * 3.0) * 0.04 * u.presence / (1.0 + d * 2.0);

    float light = caustic(p, t);
    float depth = fbm(p * 0.6 + t * 0.03, 4);

    float3 deep = u.palette[0].rgb, shallow = u.palette[1].rgb, body = u.palette[2].rgb, crest = u.palette[3].rgb;
    if (u.paletteMix < 0.5) {
        deep = float3(0.01, 0.05, 0.08);
        shallow = float3(0.02, 0.20, 0.26);
        body = float3(0.10, 0.55, 0.58);
        crest = float3(0.85, 0.97, 0.92);
    }
    float3 color = mix(deep, shallow, smoothstep(0.2, 0.8, depth));
    color = mix(color, body, smoothstep(0.35, 0.75, light) * 0.6);
    color += crest * pow(saturate(light), 3.0) * (0.35 + 0.4 * u.daylight);

    // Film grain, as the built-in shaders have it.
    color += (hash21(uv * u.resolution + t) - 0.5) * 0.04 * u.grain;
    return float4(saturate(color), 1.0);
}
