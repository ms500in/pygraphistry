import {
    ref as $ref,
    atom as $atom,
    pathValue as $value
} from '@graphistry/falcor-json-graph';

export function camera(scene) {
    return {
        camera: {
            width: 1, height: 1, zoom: 1,
            center: $atom({ x: 0.5, y: 0.5 }),
            edges: { scaling: 1, opacity: 1 },
            points: { scaling: 1, opacity: 1 },
            controls: [{
                id: 'zoom-in',
                name: 'Zoom in',
                type: 'multiply',
                value: $atom(1 / 1.25),
                values: $atom($ref(`${scene}.camera.zoom`).value)
            }, {
                id: 'zoom-out',
                name: 'Zoom out',
                type: 'multiply',
                value: $atom(1.25),
                values: $atom($ref(`${scene}.camera.zoom`).value)
            }, {
                id: 'center-camera',
                name: 'Center view',
                type: 'call',
                value: $ref(`${scene}.camera.center`)
            }],
            options: {
                id: 'appearance',
                name: 'Appearance',
                length: 4, ...[{
                    id: 'point-size',
                    type: 'discrete',
                    name: 'Point Size',
                    props: {
                        min: 1, max: 100,
                        step: 1, scale: 'log'
                    },
                    stateKey: 'scaling',
                    state: $ref(`${scene}.camera.points`)
                }, {
                    id: 'edge-size',
                    type: 'discrete',
                    name: 'Edge Size',
                    props: {
                        min: 1, max: 100,
                        step: 1, scale: 'log'
                    },
                    stateKey: 'scaling',
                    state: $ref(`${scene}.camera.edges`)
                }, {
                    id: 'point-opacity',
                    type: 'discrete',
                    name: 'Point Opacity',
                    props: {
                        min: 1, max: 100,
                        step: 1, scale: 'percent'
                    },
                    stateKey: 'opacity',
                    state: $ref(`${scene}.camera.points`)
                }, {
                    id: 'edge-opacity',
                    type: 'discrete',
                    name: 'Edge Opacity',
                    props: {
                        min: 1, max: 100,
                        step: 1, scale: 'percent'
                    },
                    stateKey: 'opacity',
                    state: $ref(`${scene}.camera.edges`)
                }]
            }
        }
    };
}
