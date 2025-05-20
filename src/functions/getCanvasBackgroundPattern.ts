import { TensorMemoryLayout } from './parseMemoryConfig';

const FG_COLOUR = 'rgba(0, 0, 0, 0.7)';

function getCanvasBackgroundPattern(
    ctx: CanvasRenderingContext2D,
    layoutType: TensorMemoryLayout,
    position: number,
    canvasWidth: number,
    canvasHeight: number,
): string | null {
    const pattern: string | null = null;

    switch (layoutType) {
        case TensorMemoryLayout.INTERLEAVED: {
            drawDots(ctx, position, canvasHeight, canvasWidth);
            break;
        }
        case TensorMemoryLayout.BLOCK_SHARDED: {
            drawVerticalLines(ctx, position, canvasHeight, canvasWidth);
            drawHorizontalLines(ctx, position, canvasHeight, canvasWidth);
            break;
        }
        case TensorMemoryLayout.HEIGHT_SHARDED: {
            drawVerticalLines(ctx, position, canvasHeight, canvasWidth);
            break;
        }
        case TensorMemoryLayout.WIDTH_SHARDED: {
            drawHorizontalLines(ctx, position, canvasHeight, canvasWidth);
            break;
        }
        default:
            break;
    }

    return pattern;
}

const drawHorizontalLines = (ctx: CanvasRenderingContext2D, position: number, height: number, width: number) => {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = FG_COLOUR;
    ctx.lineWidth = 1;
    const spacing = 5;

    for (let y = 1; y < height; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(position, y);
        ctx.lineTo(position + width, y);
        ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
};

const drawVerticalLines = (ctx: CanvasRenderingContext2D, position: number, height: number, width: number) => {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = FG_COLOUR;
    ctx.lineWidth = 1;
    const spacing = 5;

    for (let x = position; x < position + width; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, 1);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
};

const drawDots = (ctx: CanvasRenderingContext2D, position: number, height: number, width: number) => {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = FG_COLOUR;
    const dotRadius = 1;
    const spacing = 4;

    for (let x = position + spacing / 2; x < position + width; x += spacing) {
        for (let y = spacing / 2; y < height; y += spacing) {
            ctx.beginPath();
            ctx.arc(x, y, dotRadius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
};

export default getCanvasBackgroundPattern;
