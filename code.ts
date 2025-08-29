// Plugin: SVG → Ready for CSS
// Funciona exportando a seleção como SVG e gerando um data URL seguro para uso em CSS.

figma.showUI(__html__, { width: 560, height: 420 });

// Converte Uint8Array -> string sem TextDecoder (evita erro TS2304)
function bytesToString(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000; // evita stack overflow no apply
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    result += String.fromCharCode(...Array.from(chunk));
  }
  return result;
}

// Normaliza e "escapa" caracteres problemáticos para data:image/svg+xml em CSS
function encodeSVGForCSS(svg: string): string {
  let s = svg;

  // Garante namespace se ausente
  if (s.indexOf('http://www.w3.org/2000/svg') < 0) {
    s = s.replace(/<svg\b/, `<svg xmlns="http://www.w3.org/2000/svg"`);
  }

  // Minifica: remove quebras e espaços redundantes
  s = s.replace(/>\s+</g, '><')
       .replace(/\s{2,}/g, ' ')
       .replace(/[\r\n\t]/g, ' ')
       .trim();

  // Aspas simples para reduzir escapes
  s = s.replace(/"/g, `'`);

  // Escapes seguros (inspirado no padrão usado por ferramentas como yoksel/url-encoder)
  s = s
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/{/g, '%7B')
    .replace(/}/g, '%7D')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/&/g, '%26');

  return s;
}

async function convertSelectionToCSS() {
  const sel = figma.currentPage.selection;
  if (!sel.length) {
    figma.notify('Selecione um objeto primeiro.');
    figma.ui.postMessage({ type: 'result', css: '', previewUrl: '', width: 150, height: 150 });
    return;
  }

  const node = sel[0];

  try {
    // Exporta como SVG
    const svgBytes = await node.exportAsync({
      format: 'SVG',
      // opções deixam o SVG mais fiel (ajuste se preferir outlines simplificados):
      svgIdAttribute: false,
      svgOutlineText: false,
      svgSimplifyStroke: false
    });

    const svg = bytesToString(svgBytes);
    const encoded = encodeSVGForCSS(svg);
    const dataUrl = `data:image/svg+xml,${encoded}`;
    const css = `background-image: url('${dataUrl}');`;

    const width = Math.max(1, Math.round((node as GeometryMixin).width ?? 150));
    const height = Math.max(1, Math.round((node as GeometryMixin).height ?? 150));

    figma.ui.postMessage({
      type: 'result',
      css,
      previewUrl: dataUrl,
      width,
      height
    });
  } catch (err) {
    console.error(err);
    figma.notify('Erro ao exportar como SVG.');
    figma.ui.postMessage({ type: 'result', css: '', previewUrl: '', width: 150, height: 150 });
  }
}

figma.ui.onmessage = (msg) => {
  if (msg.type === 'convert') {
    convertSelectionToCSS();
  }
};
