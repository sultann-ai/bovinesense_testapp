/**
 * The terra-draw modes the geofence editor uses, in one place so the app and its tests build exactly
 * the same thing: polygon, circle (click the centre, move, click for the radius) and select (drag
 * corners, add corners at midpoints, drag or resize a circle).
 *
 * Colours are passed in (read from the design tokens by the caller); terra-draw wants literals.
 */
import { TerraDrawCircleMode, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";

export type Hex = `#${string}`;

export interface DrawColors {
  brand: Hex;
  highlight: Hex;
  charcoal: Hex;
}

export function buildDrawModes({ brand, highlight, charcoal }: DrawColors) {
  const shapeStyles = { fillColor: brand, outlineColor: brand, fillOpacity: 0.1, outlineWidth: 2 };
  return [
    new TerraDrawPolygonMode({ styles: shapeStyles }),
    new TerraDrawCircleMode({ drawInteraction: "click-move", styles: shapeStyles }),
    new TerraDrawSelectMode({
      flags: {
        polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
        circle: { feature: { draggable: true, coordinates: { resizable: "center-fixed" } } },
      },
      styles: {
        selectedPolygonColor: brand,
        selectedPolygonFillOpacity: 0.12,
        selectedPolygonOutlineColor: brand,
        selectedPolygonOutlineWidth: 3,
        selectionPointColor: highlight,
        selectionPointOutlineColor: charcoal,
        midPointColor: highlight,
        midPointOutlineColor: charcoal,
      },
    }),
  ];
}
