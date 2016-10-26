import { toProps } from '@graphistry/falcor';
import { Settings } from 'viz-shared/containers/settings';
import { container } from '@graphistry/falcor-react-redux';
import LabelsComponent from 'viz-shared/components/labels';

let Labels = ({ edge = [], point = [], highlight = {}, selection = {}, ...props }) => {
    return (
        <LabelsComponent edge={toProps(edge)}
                         point={toProps(point)}
                         highlight={toProps(highlight)}
                         selection={toProps(selection)}
                         {...props}/>
    );
};

Labels = container(
    ({ edge = [], point = [], settings } = {}) => `{
        id, name, timeZone,
        opacity, enabled, poiEnabled,
        ['background', 'foreground']: { color },
        ...${ Settings.fragment({ settings }) },
        highlight: {
            label: {
                'type', 'index', 'title', 'columns', 'formatted'
            }
        },
        selection: {
            label: {
                'type', 'index', 'title', 'columns', 'formatted'
            }
        },
        edge: {
            length, [0...${edge.length || 0}]: {
                'type', 'index', 'title', 'columns', 'formatted'
            }
        },
        point: {
            length, [0...${point.length || 0}]: {
                'type', 'index', 'title', 'columns', 'formatted'
            }
        }
    }`
)(Labels);

export { Labels }