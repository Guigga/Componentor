// --- Definição das Cores ---
const PADDING_FILL: SolidPaint = {
  type: 'SOLID',
  color: { r: 1, g: 0.4, b: 0.4 }, // Vermelho claro para Padding
  opacity: 0.4
};

const GAP_FILL: SolidPaint = {
  type: 'SOLID',
  color: { r: 0.48, g: 0.38, b: 1 }, // Roxo para Gap
  opacity: 0.5
};

// --- ESTILOS DO RÓTULO ATUALIZADOS ---
const LABEL_BACKGROUND_FILL: SolidPaint = {
    type: 'SOLID',
    color: {r: 1, g: 1, b: 1},
    opacity: 0.8 // Opacidade ajustada para 80%
};

const LABEL_TEXT_FILL: SolidPaint = {
    type: 'SOLID',
    // Cor ajustada para #2D2D2D (45/255)
    color: {r: 45 / 255, g: 45 / 255, b: 45 / 255} 
};

// --- Distância que o rótulo ficará do elemento principal ---
const LABEL_OFFSET = 8;


// Mostra a interface do usuário (UI)
figma.showUI(__html__, { width: 280, height: 200 });

// Função para criar os rótulos numéricos
async function createLabel(value: number, position: {x: number, y: number}): Promise<FrameNode> {
    const text = figma.createText();
    text.characters = String(Math.round(value));
    text.fontSize = 10;
    text.fills = [LABEL_TEXT_FILL];
    text.textAlignHorizontal = 'CENTER';
    text.textAlignVertical = 'CENTER';

    const padding = 2;
    const rect = figma.createRectangle();
    rect.name = "Label Background";
    rect.resize(text.width + padding * 2, text.height + padding * 2);
    rect.cornerRadius = 4;
    rect.fills = [LABEL_BACKGROUND_FILL];
    
    const labelGroup = figma.createFrame();
    labelGroup.name = `[${value}px]`;
    labelGroup.backgrounds = [];
    labelGroup.resize(rect.width, rect.height);

    rect.x = 0;
    rect.y = 0;
    text.x = (rect.width / 2) - (text.width / 2);
    text.y = (rect.height / 2) - (text.height / 2);

    labelGroup.appendChild(rect);
    labelGroup.appendChild(text);

    labelGroup.x = position.x - (labelGroup.width / 2);
    labelGroup.y = position.y - (labelGroup.height / 2);

    return labelGroup;
}


// Ouve as mensagens da UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'visualize-layout') {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    
    const selection = figma.currentPage.selection;

    if (selection.length !== 1) {
      figma.notify('⚠️ Por favor, selecione exatamente um item.', { error: true });
      return;
    }
    const originalNode = selection[0];
    if (originalNode.type !== 'FRAME' || originalNode.layoutMode === 'NONE') {
      figma.notify('⚠️ O item selecionado precisa ser um Frame com Auto Layout.', { error: true });
      return;
    }
    
    const frame = originalNode.clone();
    frame.name = `${originalNode.name} (Layout Viz)`;
    frame.x = originalNode.x + originalNode.width + 100; // Aumentei um pouco a distância do clone
    frame.y = originalNode.y;
    
    const vizElements: BaseNode[] = [];

    // --- LÓGICA DE PADDING CORRIGIDA ---
    // Os blocos de medida voltam a ficar sobrepostos.
    // APENAS a posição dos rótulos é movida para fora.
    if (frame.paddingTop > 0) {
        const topBlock = figma.createRectangle();
        topBlock.resize(frame.width, frame.paddingTop);
        topBlock.x = frame.x;
        topBlock.y = frame.y;
        topBlock.fills = [PADDING_FILL];
        vizElements.push(topBlock);
        
        // Posição do rótulo: 8px ACIMA do frame
        const labelPosition = {
            x: frame.x + frame.width / 2, 
            y: frame.y - LABEL_OFFSET
        };
        const label = await createLabel(frame.paddingTop, labelPosition);
        vizElements.push(label);
    }
    if (frame.paddingBottom > 0) {
        const bottomBlock = figma.createRectangle();
        bottomBlock.resize(frame.width, frame.paddingBottom);
        bottomBlock.x = frame.x;
        bottomBlock.y = frame.y + frame.height - frame.paddingBottom;
        bottomBlock.fills = [PADDING_FILL];
        vizElements.push(bottomBlock);

        // Posição do rótulo: 8px ABAIXO do frame
        const labelPosition = {
            x: frame.x + frame.width / 2, 
            y: frame.y + frame.height + LABEL_OFFSET
        };
        const label = await createLabel(frame.paddingBottom, labelPosition);
        vizElements.push(label);
    }
    if (frame.paddingLeft > 0) {
        const height = frame.height - frame.paddingTop - frame.paddingBottom;
        const leftBlock = figma.createRectangle();
        leftBlock.resize(frame.paddingLeft, height);
        leftBlock.x = frame.x;
        leftBlock.y = frame.y + frame.paddingTop;
        leftBlock.fills = [PADDING_FILL];
        vizElements.push(leftBlock);
        
        // Posição do rótulo: 8px À ESQUERDA do frame
        const labelPosition = {
            x: frame.x - LABEL_OFFSET, 
            y: frame.y + frame.height / 2
        };
        const label = await createLabel(frame.paddingLeft, labelPosition);
        vizElements.push(label);
    }
    if (frame.paddingRight > 0) {
        const height = frame.height - frame.paddingTop - frame.paddingBottom;
        const rightBlock = figma.createRectangle();
        rightBlock.resize(frame.paddingRight, height);
        rightBlock.x = frame.x + frame.width - frame.paddingRight;
        rightBlock.y = frame.y + frame.paddingTop;
        rightBlock.fills = [PADDING_FILL];
        vizElements.push(rightBlock);
        
        // Posição do rótulo: 8px À DIREITA do frame
        const labelPosition = {
            x: frame.x + frame.width + LABEL_OFFSET, 
            y: frame.y + frame.height / 2
        };
        const label = await createLabel(frame.paddingRight, labelPosition);
        vizElements.push(label);
    }

    // Lógica para Gap (rótulo continua no centro do bloco roxo)
    if (frame.children.length > 1 && frame.itemSpacing > 0) {
      const children = frame.children;
      for (let i = 0; i < children.length - 1; i++) {
        const currentChild = children[i];
        const gapBlock = figma.createRectangle();
        gapBlock.fills = [GAP_FILL];
        const childRelativeX = currentChild.relativeTransform[0][2];
        const childRelativeY = currentChild.relativeTransform[1][2];

        if (frame.layoutMode === 'HORIZONTAL') {
          gapBlock.resize(frame.itemSpacing, currentChild.height);
          gapBlock.x = frame.x + childRelativeX + currentChild.width;
          gapBlock.y = frame.y + childRelativeY;
        } else { // 'VERTICAL'
          gapBlock.resize(currentChild.width, frame.itemSpacing);
          gapBlock.x = frame.x + childRelativeX;
          gapBlock.y = frame.y + childRelativeY + currentChild.height;
        }
        vizElements.push(gapBlock);
        // O rótulo do Gap continua no centro, pois faz mais sentido visualmente
        const label = await createLabel(frame.itemSpacing, {x: gapBlock.x + gapBlock.width / 2, y: gapBlock.y + gapBlock.height / 2});
        vizElements.push(label);
      }
    }

    // Agrupamento e Finalização
    if (vizElements.length > 0) {
      const group = figma.group([frame, ...vizElements], originalNode.parent);
      group.name = `${originalNode.name} - Layout Visualization`;
      figma.currentPage.selection = [group];
      figma.viewport.scrollAndZoomIntoView([group]);
      figma.notify('✅ Visualização de layout criada com sucesso!');
    } else {
      figma.notify('ℹ️ O frame selecionado não possui padding ou gap para visualizar.');
      frame.remove();
    }

    figma.closePlugin();
  }
};