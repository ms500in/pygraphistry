import { Model } from 'viz-client/falcor';
import $$observable from 'symbol-observable';
import { Observable } from 'rxjs/Observable';
import { AsyncSubject } from 'rxjs/AsyncSubject';
import { asap as AsapScheduler } from 'rxjs/scheduler/asap';
import { PostMessageDataSource } from '@graphistry/falcor-socket-datasource';
import fetchDataUntilSettled from '@graphistry/falcor-react-redux/lib/utils/fetchDataUntilSettled';
import {
    ref as $ref,
    atom as $atom,
    pathValue as $value,
    pathInvalidation as $invalidate
} from '@graphistry/falcor-json-graph';

/**
 * @class Graphistry
 * @classdesc This object wraps a HTML IFrame of a Graphistry Visualization in order
 * to provide an API for interacting with the graph.
 * @extends Observable
 */
class Graphistry extends Observable {
    static view = null;
    static model = null;
    static workbook = null;
    static iFrame = null;

    /**
     * Create Graphistry Observable by extending observable's methods
     * @param {Object} source - The source observable.
     */
    constructor(source) {
        if (!source || typeof source === 'function' || typeof source !== 'object') {
            super(source);
        } else {
            super();
            if (typeof source[$$observable] === 'function') {
                this.source = source[$$observable]();
            } else {
                this.source = this.constructor.from(source);
            }
        }
    }

    /**
     * Creates a new Observable with this as the source, and the passed
     * operator as the new Observable's operator.
     * @method Graphistry~lift
     * @param {Operator} operator - the operator defining the operation to take on the
     * observable
     * @return {Observable} a new observable with the operator applied
     */
    lift(operator) {
        const observable = new Graphistry(this);
        observable.operator = operator;
        return observable;
    }

    /**
     * Add columns to the current graph visuzliation's dataset
     * @method Graphistry.addColumns
     * @params {...Arrays} columns - One of more columns to be appended to the dataset
     * @return {Promise} A promise to return the result of the callback
     * @example
     * GraphistryJS(document.getElementById('viz'))
     *     .flatMap(function() {
     *         const columns = [
     *             ['edge', 'highways', [66, 101, 280], 'number'],
     *             ['point', 'theme parks', ['six flags', 'disney world', 'great america'], 'string']
     *         ];
     *         console.log('adding columns', columns);
     *         return g.addColumns.apply(g, columns);
     *     })
     */
    static addColumns(...columns) {
        const { view } = this;
        return new this(this
            .from(columns)
            .concatMap((column) => view.call('columns.add', column))
            .takeLast(1)
            .mergeMap(() => fetchDataUntilSettled({
                data: {}, falcor: view, fragment: ({ columns = [] } = {}) => `{
                    columns: {
                        length, [0...${columns.length || 0}]: {
                            name, dataType, identifier, componentType
                        }
                    }
                }`
            }))
            .takeLast(1)
            .map(({ data }) => data.toJSON())
            .toPromise()
        );
    }

    /**
     * Open the filters panel
     * @method Graphistry.openFilters
     * @return {Promise} The result of the callback
     * @example
     *  GraphistryJS(document.getElementById('viz'))
     *     .flatMap(function (g) {
     *         window.g = g;
     *         document.getElementById('controls').style.opacity=1.0;
     *         console.log('opening filters');
     *         return g.openFilters();
     *     })
     */
    static openFilters() {
        const { view } = this;
        return new this(view.set(
            $value(`filters.controls[0].selected`, true),
            $value(`scene.controls[1].selected`, false),
            $value(`labels.controls[0].selected`, false),
            $value(`layout.controls[0].selected`, false),
            $value(`exclusions.controls[0].selected`, false),
            $value(`panels.left`, $ref(view._path.concat(`filters`)))
        )
        .map(({ json }) => json.toJSON())
        .toPromise());
    }

    /**
     * Close the filters panel
     * @method Graphistry.closeFilters
     * @return {Promise} The result of the callback
     * GraphistryJS(document.getElementById('viz'))
     *     .flatMap(function (g) {
     *         window.g = g;
     *         console.log('closing filters');
     *         return g.closeFilters();
     *     })
     */
    static closeFilters() {
        const { view } = this;
        return new this(view.set(
            $value(`panels.left`, undefined),
            $value(`filters.controls[0].selected`, false)
        )
        .map(({ json }) => json.toJSON())
        .toPromise());
    }

    /**
     * Run Graphistry's clustering algorithm
     * @method Graphistry.startClustering
     * @static
     * @param {number} [milliseconds = 2000] - The number of seconds to run layout
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * @example
     * GraphistryJS(document.getElementById('viz'))
     *     .flatMap(function (g) {
     *         window.g = g;
     *         console.log('starting to cluster');
     *         return g.startClustering(3000);
     *     })
     */
    static startClustering(milliseconds = 2000, cb) {
        const { view } = this;
        if (!milliseconds || milliseconds <= 0) {
            return new this(view.set(
                $value(`scene.simulating`, true),
                $value(`scene.controls[0].selected`, true)
            )
            .last()
            .map(({ json }) => json.toJSON())
            .do((x) => cb && cb(null, x), cb)
            .toPromise());
        }
        return new this(this
            .startClustering(0)
            .concat(this
                .timer(milliseconds)
                .mergeMap(() => this.stopClustering(cb)))
            .toPromise());
    }

    /**
     * Stop Graphistry's clustering algorithm
     * @method Graphistry.stopClustering
     * @static
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * @example
     * GraphistryJS(document.getElementById('viz'))
     *     .flatMap(function (g) {
     *         window.g = g;
     *         console.log('stopping clustering');
     *         return g.startClustering();
     *     })
     */
    static stopClustering(cb) {
        const { view } = this;
        return new this(view.set(
            $value(`scene.simulating`, false),
            $value(`scene.controls[0].selected`, false)
        )
        .last()
        .map(({ json }) => json.toJSON())
        .do((x) => cb && cb(null, x), cb)
        .toPromise());
    }

    /**
     * Center the view of the graph
     * @method Graphistry.autocenter
     * @static
     * @param {number} percentile - Controls sensitivity to outliers
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * GraphistryJS(document.getElementById('viz'))
     *     .flatMap(function (g) {
     *         window.g = g;
     *         console.log('centering');
     *         return g.autocenter(.90);
     *     })
     */
    static autocenter(percentile, cb) {

    }

    /**
     * Save the current workbook. A saved workbook will persist the analytics state
     * of the visualization, including active filters and exclusions
     * @method Graphistry.autocenter
     * @static
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * GraphistryJS(document.getElementById('viz'))
     *     .flatMap(function (g) {
     *         window.g = g;
     *         return g.saveWorkbook(.90);
     *     })
     */
    static saveWorkbook(cb) {

    }

    /**
     * Export a static visualization so that it can be shared publicly;
     * @method Graphistry.exportStatic
     * @static
     * @param {string} name - The name of the static vizualization
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * @example
     * GraphistryJS(document.getElementById('viz'))
     *     .flatMap(function (g) {
     *         window.g = g;
     *         return g.exportStatic('MyExportedLink');
     *     })
     */
    static exportStatic(name, cb) {

    }

    /**
     * Hide or Show Chrome UI
     * @method Graphistry.toogleChrome
     * @static
     * @param {boolean} show - Set to true to show chrome, and false to hide chrome.
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * @example
     *
     * <button onclick="window.graphistry.toggleChrome(false)">Hide chrome</button>
     * <button onclick="window.graphistry.toggleChrome(true)">Show chrome</button>
     *
     */
    static toggleChrome(show, cb) {
        const { view } = this;
        return new this(view.set(
            $value(`toolbar.visible`, !!show)
        )
        .last()
        .map(({ json }) => json.toJSON())
        .do((x) => cb && cb(null, x), cb)
        .toPromise());
    }

    /**
     * Add a filter to the visualization with the given expression
     * @method Graphistry.addFilter
     * @static
     * @param {string} expr - An expression using the same language as our in-tool
     * exclusion and filter panel
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * @example
     * graphistry.addFilter('degree > 0');
     */
    static addFilter(expr, cb) {

    }

    /**
     * Add an to the visualization with the given expression
     * @method Graphistry.addExclusion
     * @static
     * @param {string} expr - An expression using the same language as our in-tool
     * exclusion and filter panel
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * @example
     * graphistry.addExclusion('degree > 0');
     */
    static addExclusion(expr, cb) {

    }

    /**
     * Add an to the visualization with the given expression
     * @method Graphistry.updateEncoding
     * @static
     * @param {string} entityType - An expression using the same language as our in-tool
     * exclusion and filter panel
     * @param {string} entityAttribute - The visual attribute you would like to encode
     * @param {string} encodingMode - The type of encoding
     * @param {string} dataAttribute - The attribute of the entity, that will
     * define it encoding
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     * @example
     * // Encode point sizes by the attribute community_spinglass using
     * // categorical encodings
     * encoding = ['point', 'size', 'categorical', 'community_spinglass'];
     * graphistry.updateEncoding(encoding);
     */
    static updateEncoding(entityType, encodingAttribute, encodingMode, dataAttribute, cb) {

    }

    /**
     * Add an to the visualization with the given expression
     * @method Graphistry.updateSetting
     * @static
     * @param {string} name - the name of the setting to change
     * @param {string} val - the value to set the setting to.
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     */
    static updateSetting(name, val, cb) {

    }

    /**
     * Add an to the visualization with the given expression
     * @method Graphistry.updateZoom
     * @static
     * @param {string} level - Controls how far to zoom in or out.
     * @param {string} val - the value to set the setting to.
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     */
    static updateZoom(level, cb) {

    }

    /**
     * Subscribe to label events
     * @method Graphistry.subscribeLabels
     * @static
     * @param {subscriptions} subscriptions - A list of subscriptions that
     * will subscribe to any label updates
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     */
    static subscribeLabels(subscriptions, cb) {

    }

    /**
     * Unsubscribe from label events
     * @method Graphistry.unsubscribeLabels
     * @static
     * @param {subscriptions} subscriptions - A list of subscriptions that
     * will subscribe to any label updates
     * @param {function} [cb] - Callback function of type callback(error, result)
     * @return {Promise} The result of the callback
     */
    static unsubscribeLabels(cb) {

    }
}

/**
 * Function that creates a Graphistry Wrapped IFrame
 * @func GraphistryJS
 * @param {Object} IFrame - An IFrame that incudes a Graphistry visualization.
 * @return {Graphistry}
 * @example
 *
 * <iframe id="viz" src="http://127.0.0.1:10000/graph/graph.html?dataset=Miserables" />
 * <script>
 * document.addEventListener("DOMContentLoaded", function () {
 *
 *     GraphistryJS(document.getElementById('viz'))
 *         .flatMap(function (g) {
 *             window.g = g;
 *             document.getElementById('controls').style.opacity=1.0;
 *             console.log('opening filters');
 *             return g.openFilters();
 *         })
 *         .delay(5000)
 *         .flatMap(function() {
 *             console.log('filters opened');
 *             const columns = [
 *                 ['edge', 'highways', [66, 101, 280], 'number'],
 *                 ['point', 'theme parks', ['six flags', 'disney world', 'great america'], 'string']
 *             ];
 *             console.log('adding columns', columns);
 *             return g.addColumns.apply(g, columns);
 *        })
 *         .subscribe(function (result) {
 *             console.log('all columns: ', result);
 *         });
 * });
 * </script>
 *
 */
function GraphistryJS(iFrame) {

    if (!iFrame) {
        throw new Error('No iframe provided to Graphistry');
    }

    const model = new Model({
        recycleJSON: true,
        scheduler: AsapScheduler,
        treatErrorsAsValues: true,
        allowFromWhenceYouCame: true,
        source: new PostMessageDataSource(window, iFrame.contentWindow)
    });

    class InstalledGraphistry extends Graphistry {
        static model = model;
        static iFrame = iFrame;
        lift(operator) {
            const observable = new InstalledGraphistry(this);
            observable.operator = operator;
            return observable;
        }
    }

    InstalledGraphistry = wrapStaticObservableMethods(Observable, InstalledGraphistry);

    return InstalledGraphistry.defer(() => {

        const initEvent = Observable
            .fromEvent(window, 'message')
            .filter(({ data }) => data && data.type === 'init')
            .do(({ data }) => model.setCache(data.cache))
            .mergeMap(
                ({ data }) => model.get(`workbooks.open.views.current.id`),
                ({ data, source }, { json }) => {

                    const workbook = json.workbooks.open;
                    const view = workbook.views.current;

                    InstalledGraphistry.workbook = model.deref(workbook);
                    InstalledGraphistry.view = model.deref(view);

                    console.log(`initialized with view '${view.id}'`);
                    console.log('parent sending initialized message');

                    source.postMessage({
                        type: 'initialized',
                        agent: 'graphistryjs',
                        version: __VERSION__
                    }, '*');

                    return InstalledGraphistry;
                }
            )
            .take(1)
            .multicast(new AsyncSubject());

        initEvent.connect();

        console.log('parent sending ready message');

        // trigger hello if missed initial one
        iFrame.contentWindow.postMessage({
            type: 'ready',
            agent: 'graphistryjs',
            version: __VERSION__
        }, '*');

        return initEvent;
    });
}

import 'rxjs/add/operator/do';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/last';
import 'rxjs/add/operator/take';
import 'rxjs/add/operator/delay';
import 'rxjs/add/operator/merge';
import 'rxjs/add/operator/concat';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/concatMap';
import 'rxjs/add/operator/multicast';
import 'rxjs/add/operator/toPromise';
import 'rxjs/add/operator/takeUntil';

import 'rxjs/add/observable/of';
import 'rxjs/add/observable/from';
import 'rxjs/add/observable/defer';
import 'rxjs/add/observable/timer';
import 'rxjs/add/observable/merge';
import 'rxjs/add/observable/concat';
import 'rxjs/add/observable/fromEvent';
import 'rxjs/add/observable/bindCallback';

Graphistry = wrapStaticObservableMethods(Observable, Graphistry);

module.exports = GraphistryJS;
module.exports.GraphistryJS = GraphistryJS;

function wrapStaticObservableMethods(Observable, Graphistry) {
    function createStaticWrapper(staticMethodName) {
        return function(...args) {
            return new Graphistry(Observable[staticMethodName](...args));
        }
    }
    for (const staticMethodName in Observable) {
        Graphistry[staticMethodName] = createStaticWrapper(staticMethodName);
    }
    Graphistry.bindCallback = (...args) => (...args2) => new Graphistry(Observable.bindCallback(...args)(...args2));
    return Graphistry;
}
