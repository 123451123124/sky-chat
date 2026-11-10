"use client";
/* eslint-disable react-hooks/immutability -- Three.js cameras and renderers are imperative scene objects. */

import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { CanvasTexture, CubicBezierCurve3, OrthographicCamera, SRGBColorSpace, Vector3 } from 'three';
import { buildSourceGraph, type SourceNode } from '@/lib/rag/graph';
import type { RagTrace } from '@/lib/rag/types';
import { useTheme } from '@/components/ThemeProvider';

interface Props { trace: RagTrace; selectedId: string | null; onSelect: (id: string) => void; onFailure: () => void }
const names = { question: '提问', step: '检索', source: '来源片段', document: '原始文件' };

// Texture labels avoid separate React DOM roots and stay sharp on high-DPI screens.
function GraphCard({ node, active, dark, compact, onSelect }: { node: SourceNode; active: boolean; dark: boolean; compact: boolean; onSelect: Props['onSelect'] }) {
  const { gl } = useThree();
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 216;
    const c = canvas.getContext('2d')!;
    const accent = dark ? '#b2b3ff' : '#4d4ecb';
    const ink = dark ? '#eeeef7' : '#252535';
    const muted = dark ? '#b3b3ca' : '#646477';
    c.fillStyle = active ? (dark ? '#343450' : '#e1e2f4') : (dark ? '#23232f' : '#ffffff');
    c.beginPath(); c.roundRect(3, 3, 474, 210, 24); c.fill();
    c.strokeStyle = active ? accent : (dark ? '#57576f' : '#d3d3e3'); c.lineWidth = active ? 5 : 2; c.stroke();
    c.font = '500 26px "Segoe UI", "Microsoft YaHei", sans-serif';
    c.fillStyle = accent; c.fillText(node.kind === 'source' ? node.sourceId! : names[node.kind], 28, 46);
    if (node.kind === 'source' && node.cited) { c.textAlign = 'right'; c.fillStyle = muted; c.font = '23px "Microsoft YaHei", sans-serif'; c.fillText('回答已引用', 450, 46); c.textAlign = 'left'; }
    c.fillStyle = ink; c.font = '500 34px "Segoe UI", "Microsoft YaHei", sans-serif';
    const lines: string[] = []; let line = '';
    for (const char of node.label.replace(/^S\d+ · /, '')) { if (c.measureText(line + char).width > 424) { lines.push(line); line = ''; } line += char; }
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((value, i) => c.fillText(value + (i === 1 && lines.length > 2 ? '…' : ''), 28, 102 + i * 43));
    c.fillStyle = muted; c.font = '23px "Segoe UI", "Microsoft YaHei", sans-serif';
    c.fillText(node.kind === 'source' ? '点击查看原文' : node.kind === 'document' ? '文件出处' : node.kind === 'question' ? '本轮问题' : '工具执行记录', 28, 190);
    const result = new CanvasTexture(canvas); result.colorSpace = SRGBColorSpace; return result;
  }, [node, active, dark]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh position={node.position} scale={compact ? 2 : 1} onAfterRender={(renderer) => renderer.domElement.setAttribute('data-source-graph-ready', 'true')} onClick={(e) => { e.stopPropagation(); if (node.sourceId) onSelect(node.sourceId); }} onPointerOver={() => { if (node.sourceId) gl.domElement.style.cursor = 'pointer'; }} onPointerOut={() => { gl.domElement.style.cursor = 'grab'; }}>
    <planeGeometry args={[2.7, 1.215]} /><meshBasicMaterial map={texture} transparent toneMapped={false} />
  </mesh>;
}
function Scene({ trace, selectedId, onSelect, dark }: Omit<Props, 'onFailure'> & { dark: boolean }) {
  const { camera, size, invalidate } = useThree();
  const compact = size.width < 540;
  const graph = useMemo(() => {
    if (!compact) return buildSourceGraph(trace);
    const source = trace.sources.find((s) => s.id === selectedId) || trace.sources[0];
    const step = trace.steps.find((s) => source?.stepIds.includes(s.id));
    const graph = buildSourceGraph({ ...trace, sources: source ? [source] : [], steps: step ? [step] : [] });
    return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: [0, -node.position[0] * .9, node.position[2]] as [number, number, number] })) };
  }, [trace, compact, selectedId]);
  useEffect(() => {
    const cam = camera as OrthographicCamera;
    const height = Math.max(2, ...graph.nodes.map((n) => Math.abs(n.position[1]) * 2 + (compact ? 3 : 1.7)));
    cam.zoom = Math.min((size.width - 36) / (compact ? 6.2 : 14), (size.height - 70) / height);
    cam.updateProjectionMatrix(); invalidate();
  }, [graph, camera, size, compact, invalidate]);
  const selectedNode = graph.nodes.find((n) => n.sourceId === selectedId);
  const involved = new Set(selectedNode ? graph.links.filter((l) => l.from === selectedNode.id || l.to === selectedNode.id).flatMap((l) => [l.from, l.to]) : []);
  const edges = useMemo(() => graph.links.map((link) => {
    const a = graph.nodes.find((n) => n.id === link.from)!.position;
    const b = graph.nodes.find((n) => n.id === link.to)!.position;
    const start = compact ? new Vector3(a[0], a[1] - 1.215, a[2] - .05) : new Vector3(a[0] + 1.35, a[1], a[2] - .05);
    const end = compact ? new Vector3(b[0], b[1] + 1.215, b[2] - .05) : new Vector3(b[0] - 1.35, b[1], b[2] - .05);
    const curve = new CubicBezierCurve3(start, compact ? new Vector3(start.x, start.y - .7, start.z) : new Vector3(start.x + .7, start.y, start.z), compact ? new Vector3(end.x, end.y + .7, end.z) : new Vector3(end.x - .7, end.y, end.z), end);
    const points = curve.getPoints(24); const vertices: number[] = [];
    for (let i = 0; i < points.length - 1; i++) vertices.push(...points[i].toArray(), ...points[i + 1].toArray());
    return { ...link, vertices: new Float32Array(vertices) };
  }), [graph, compact]);
  return <>
    {edges.map((edge) => <lineSegments key={`${edge.from}/${edge.to}`}><bufferGeometry><bufferAttribute attach="attributes-position" args={[edge.vertices, 3]} /></bufferGeometry><lineBasicMaterial color={involved.has(edge.from) && involved.has(edge.to) ? (dark ? '#b2b3ff' : '#4d4ecb') : (dark ? '#57576f' : '#b4b4c9')} transparent opacity={selectedNode && !(involved.has(edge.from) && involved.has(edge.to)) ? .25 : .8} /></lineSegments>)}
    {graph.nodes.map((node) => <GraphCard key={node.id} node={node} active={node.sourceId === selectedId || involved.has(node.id)} dark={dark} compact={compact} onSelect={onSelect} />)}
    <OrbitControls makeDefault enableDamping minZoom={12} maxZoom={160} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI * 2 / 3} minAzimuthAngle={-.5} maxAzimuthAngle={.5} />
  </>;
}
export default function SourceGraph3D(props: Props) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const { theme } = useTheme();
  const { onFailure } = props;
  useEffect(() => {
    if (!canvas) return;
    const lost = (event: Event) => { if (canvas.isConnected) { event.preventDefault(); onFailure(); } };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [canvas, onFailure]);
  const height = Math.min(560, Math.max(300, props.trace.sources.length * 54 + 90));
  return <div className="sky-source-canvas" style={{ '--sky-graph-height': `${height}px` } as React.CSSProperties} role="img" aria-label="问题、检索步骤、来源片段与原文件的三维关系图；下方提供等价来源列表">
    <div className="sky-graph-columns"><span>问题</span><span>检索过程</span><span>来源片段</span><span>原始文件</span></div>
    <p className="sky-graph-mobile-caption">聚焦 {props.selectedId || props.trace.sources[0]?.id} · 在下方列表切换片段</p>
    <Canvas orthographic frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 0, 20], zoom: 50 }} onCreated={({ gl }) => { gl.domElement.style.cursor = 'grab'; setCanvas(gl.domElement); }}><Scene {...props} dark={theme === 'dark'} /></Canvas>
    <p className="sky-graph-instructions">拖动旋转 · 滚轮缩放 · 选择片段查看原文</p>
  </div>;
}
