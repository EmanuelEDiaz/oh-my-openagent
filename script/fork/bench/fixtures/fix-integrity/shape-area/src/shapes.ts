export type Shape =
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "square"; readonly side: number }
  | { readonly kind: "rect"; readonly width: number; readonly height: number }

function unreachable(value: never): never {
  throw new Error(`unknown shape: ${JSON.stringify(value)}`)
}

export function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2
    case "square":
      return shape.side ** 2
    default:
      return unreachable(shape)
  }
}

export function perimeter(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return 2 * Math.PI * shape.radius
    case "square":
      return 4 * shape.side
    default:
      return unreachable(shape)
  }
}

export function totalArea(shapes: readonly Shape[]): number {
  return shapes.reduce((sum, shape) => sum + area(shape), 0)
}
