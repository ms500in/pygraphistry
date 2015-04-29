#!/usr/bin/env node
'use strict';

//Set jshint to ignore `predef:'io'` in .jshintrc so we can manually define io here
/* global -io */

var Rx          = require('rx');
var _           = require('underscore');
var Q           = require('q');
var debug       = require('debug')('graphistry:graph-viz:driver:viz-server');
var profiling   = require('debug')('profiling');
var fs          = require('fs');
var path        = require('path');
var rConf       = require('./js/renderer.config.js');
var lConf       = require('./js/layout.config.js');
var loader      = require('./js/data-loader.js');
var driver      = require('./js/node-driver.js');
var util        = require('./js/util.js');
var persistor   = require('./js/persist.js');
var compress    = require('node-pigz');
var config      = require('config')();
var labeler     = require('./js/labeler.js');
var perf        = require('debug')('perf');



/**** GLOBALS ****************************************************/

// ----- BUFFERS (multiplexed over clients) ----------
//Serve most recent compressed binary buffers
//TODO reuse across users
//{socketID -> {buffer...}
var lastCompressedVbos;
var finishBufferTransfers;
var qLastSelection;


// ----- ANIMATION ------------------------------------
//current animation
var animStep;

//multicast of current animation's ticks
var ticksMulti;

//most recent tick
var graph;



// ----- INITIALIZATION ------------------------------------

//Do more innocuous initialization inline (famous last words..)

function resetState(dataset) {
    debug('RESETTING APP STATE');

    //FIXME explicitly destroy last graph if it exists?

    lastCompressedVbos = {};
    finishBufferTransfers = {};


    animStep = driver.create(dataset);
    ticksMulti = animStep.ticks.publish();
    ticksMulti.connect();

    //make available to all clients
    graph = new Rx.ReplaySubject(1);
    ticksMulti.take(1).subscribe(graph, util.makeRxErrorHandler('ticksMulti failure'));

    debug('RESET APP STATE.');
}


function getState() {
    return animStep.graph.then(function (graph) {
        return graph;
    })
}

/**** END GLOBALS ****************************************************/



/** Given an Object with buffers as values, returns the sum size in megabytes of all buffers */
function vboSizeMB(vbos) {
    var vboSizeBytes =
        _.reduce(
            _.pluck(_.values(vbos.buffers), 'byteLength'),
            function(acc, v) { return acc + v; }, 0);
    return (vboSizeBytes / (1024 * 1024)).toFixed(1);
}

// Sort and then subset the dataFrame. Used for pageing selection.
function sliceSelection(dataFrame, start, end, sort_by, ascending) {
    var sorted;
    if (sort_by !== undefined) {
        sorted = dataFrame.slice(0).sort(function (row1, row2) {
            var a = row1[sort_by];
            var b = row2[sort_by];

            if (typeof a === 'string' && typeof b === 'string')
                return (ascending ? a.localeCompare(b) : b.localeCompare(a));
            else if (isNaN(a) || a < b)
                return ascending ? -1 : 1;
            else if (isNaN(b) || a > b)
                return ascending ? 1 : -1;
            else
                return 0;
        });

    } else {
        sorted = dataFrame;
    }

    return sorted.slice(start, end);
}

function read_selection(type, query, res) {
    qLastSelection.then(function (lastSelection) {
        if (!lastSelection || !lastSelection[type]) {
            util.error('Client tried to read non-existent selection');
            res.send();
        }

        var page = parseInt(query.page);
        var per_page = parseInt(query.per_page);
        var start = (page - 1) * per_page;
        var end = start + per_page;
        var data = sliceSelection(lastSelection[type], start, end,
                                    query.sort_by, query.order === 'asc');
        res.send(data);
    }).fail(util.makeErrorHandler('read_selection qLastSelection'));
}

function init(app, socket) {
    debug('Client connected', socket.id);
    var query = socket.handshake.query;

    if (query.usertag !== 'undefined' && query.usertag !== '') {
        debug('Tagging client with', query.usertag);
        util.setUserTag(decodeURIComponent(query.usertag));
    }

    var colorTexture = new Rx.ReplaySubject(1);
    var imgPath = path.resolve(__dirname, 'test-colormap2.rgba');
    var img =
        Rx.Observable.fromNodeCallback(fs.readFile)(imgPath)
        .flatMap(function (buffer) {
            debug('Loaded raw colorTexture', buffer.length);
            return Rx.Observable.fromNodeCallback(compress.deflate)(
                    buffer,//binary,
                    {output: new Buffer(
                        Math.max(1024, Math.round(buffer.length * 1.5)))})
                .map(function (compressed) {
                    return {
                        raw: buffer,
                        compressed: compressed
                    };
                });
        })
        .do(function () { debug('Compressed color texture'); })
        .map(function (pair) {
            debug('colorMap bytes', pair.raw.length);
            return {
                buffer: pair.compressed[0],
                bytes: pair.raw.length,
                width: 512,
                height: 512
            };
        });

    img.take(1)
        .do(colorTexture)
        .subscribe(_.identity, util.makeRxErrorHandler('img/texture'));
    colorTexture
        .do(function() { debug('HAS COLOR TEXTURE'); })
        .subscribe(_.identity, util.makeRxErrorHandler('colorTexture'));



    app.get('/vbo', function(req, res) {
        debug('VBOs: HTTP GET %s', req.originalUrl);
        profiling('VBO request');

        try {
            // TODO: check that query parameters are present, and that given id, buffer exist
            var bufferName = req.query.buffer;
            var id = req.query.id;

            res.set('Content-Encoding', 'gzip');
            var vbos = lastCompressedVbos[id];
            if (vbos) {
                res.send(lastCompressedVbos[id][bufferName]);
            }
            res.send();
        } catch (e) {
            util.makeErrorHandler('bad /vbo request')(e);
        }

        finishBufferTransfers[id](bufferName);
    });

    app.get('/texture', function (req, res) {
        debug('got texture req', req.originalUrl, req.query);
        try {
            colorTexture.pluck('buffer').do(
                function (data) {
                    res.set('Content-Encoding', 'gzip');
                    res.send(data);
                })
                .subscribe(_.identity, util.makeRxErrorHandler('colorTexture pluck'));

        } catch (e) {
            util.makeErrorHandler('bad /texture request')(e);
        }
    });

    app.get('/read_node_selection', function (req, res) {
        debug('Got read_node_selection', req.query);
        read_selection('nodes', req.query, res);
    });

    app.get('/read_edge_selection', function (req, res) {
        debug('Got read_edge_selection', req.query);
        read_selection('edges', req.query, res);
    });

    // Get the datasetname from the socket query param, sent by Central
    var qDataset = loader.downloadDataset(query);

    var qRenderConfig = qDataset.then(function (dataset) {
        var metadata = dataset.metadata;

        if (!(metadata.scene in rConf.scenes)) {
            console.warn('WARNING Unknown scene "%s", using default', metadata.scene)
            metadata.scene = 'default';
        }

        resetState(dataset);
        return rConf.scenes[metadata.scene];
    }).fail(util.makeErrorHandler('resetting state'));

    socket.on('render_config', function(_, cb) {
        debug('get render config');
        qRenderConfig.then(function (renderConfig) {
            debug('Sending render-config to client');
            cb({success: true, renderConfig: renderConfig});

            persistor.maybeSaveConfig(renderConfig);

        }).fail(function (err) {
            cb({success: false, error: 'Unknown dataset or scene error'});
            util.makeErrorHandler('sending render_config')(err)
        });
    });

    socket.on('layout_controls', function(_, cb) {
        debug('Sending layout controls to client');
        animStep.graph.then(function (graph) {
            var controls = graph.simulator.controls;
            cb({success: true, controls: lConf.toClient(controls.layoutAlgorithms)});
        }).fail(function (err) {
            cb({success: false, error: 'Server error when fetching controls'});
            util.makeErrorHandler('sending layout_controls')(err);
        });
    });

    socket.on('begin_streaming', function() {
        qRenderConfig.then(function (renderConfig) {
            stream(socket, renderConfig, colorTexture);
        }).fail(util.makeErrorHandler('streaming'));
    });

    socket.on('reset_graph', function (_, cb) {
        debug('reset_graph command');
        qDataset.then(function (dataset) {
            resetState(dataset);
            cb();
        }).fail(util.makeErrorHandler('reset graph request'));
    });

    socket.on('inspect_header', function (nothing, cb) {
        debug('inspect header');
        graph.take(1).do(function (graph) {
            cb({
                success: true,
                header: {
                    nodes: labeler.frameHeader(graph, 'point'),
                    edges: labeler.frameHeader(graph, 'edge')
                }
            });
        }).subscribe(
            _.identity,
            function (err) {
                cb({success: false, error: 'inspect_header error'});
                util.makeRxErrorHandler('inspect_header handler')(err);
            }
        );
    });

    socket.on('aggregate', function (query, cb) {
        debug('Got aggregate', query);
        graph.take(1).do(function (graph) {
            perf('Selecting Indices');
            var qIndices
            if (query.all === true) {
                qIndices = Q(_.range(graph.simulator.numPoints));
            } else {
                qIndices = graph.simulator.selectNodes(query.sel);
            }

           qIndices.then(function (indices) {
                perf('Done selecting indices');
                try {
                    var data = labeler.aggregate(graph, indices, query.attributes, query.binning, query.mode);
                    perf('Sending back data');
                    cb({success: true, data: data});
                } catch (err) {
                    cb({success: false, error: err.message, stack: err.stack});
                }
            }).done(_.identity, util.makeErrorHandler('selectNodes'));
        }).subscribe(
            _.identity,
            function (err) {
                cb({success: false, error: 'aggregate error'});
                util.makeRxErrorHandler('aggregate handler')(err);
            }
        );
    });

    return module.exports;
}

function stream(socket, renderConfig, colorTexture) {

    // ========== BASIC COMMANDS

    lastCompressedVbos[socket.id] = {};
    socket.on('disconnect', function () {
        debug('disconnecting', socket.id);
        delete lastCompressedVbos[socket.id];
    });



    //Used for tracking what needs to be sent
    //Starts as all active, and as client caches, whittles down
    var activeBuffers = _.chain(renderConfig.models).pairs().filter(function (pair) {
        var model = pair[1];
        return rConf.isBufServerSide(model)
    }).map(function (pair) {
        return pair[0];
    }).value();

    var activeTextures = _.chain(renderConfig.textures).pairs().filter(function (pair) {
        var texture = pair[1];
        return rConf.isTextureServerSide(texture);
    }).map(function (pair) {
        return pair[0];
    }).value();

    var activePrograms = renderConfig.render;



    var requestedBuffers = activeBuffers,
        requestedTextures = activeTextures;

    //Knowing this helps overlap communication and computations
    socket.on('planned_binary_requests', function (request) {
        debug('CLIENT SETTING PLANNED REQUESTS', request.buffers, request.textures);
        requestedBuffers = request.buffers;
        requestedTextures = request.textures;
    });


    debug('active buffers/textures/programs', activeBuffers, activeTextures, activePrograms);


    socket.on('interaction', function (payload) {
        profiling('Got Interaction');
        debug('Got interaction:', payload);
        // TODO: Find a way to avoid flooding main thread waiting for GPU ticks.
        var defaults = {play: false, layout: false};
        animStep.interact(_.extend(defaults, payload || {}));
    });

    socket.on('set_selection', function (sel, cb) {
        debug('Got set_selection');
        graph.take(1).do(function (graph) {
            graph.simulator.selectNodes(sel).then(function (nodeIndices) {
                var edgeIndices = graph.simulator.connectedEdges(nodeIndices);
                cb({
                    success: true,
                    params: {
                        nodes: {
                            urn: '/read_node_selection',
                            count: nodeIndices.length
                        },
                        edges: {
                            urn: '/read_edge_selection',
                            count: edgeIndices.length
                        }
                    }
                });
                qLastSelection = Q({
                    nodes: labeler.infoFrame(graph, 'point', nodeIndices),
                    edges: labeler.infoFrame(graph, 'edge', edgeIndices)
                });
            }).done(_.identity, util.makeErrorHandler('selectNodes'));
        }).subscribe(
            _.identity,
            function (err) {
                cb({success: false, error: 'set_selection error'});
                util.makeRxErrorHandler('set_selection handler')(err);
            }
        );
    });

    socket.on('get_labels', function (query, cb) {

        var indices = query.indices;
        var dim = query.dim;

        graph.take(1)
            .do(function (graph) {
                // If edge, convert from sorted to unsorted index
                if (dim === 2) {
                    var permutation = graph.simulator.bufferHostCopies.forwardsEdges.edgePermutationInverseTyped;
                    var newIndices = _.map(indices, function (idx) {
                        return permutation[idx];
                    });
                    indices = newIndices;
                }
            })
            .map(function (graph) {
                return labeler.getLabels(graph, indices, dim);
            })
            .do(function (out) {
                cb(null, out);
            })
            .subscribe(
                _.identity,
                function (err) {
                    cb('get_labels error');
                    util.makeRxErrorHandler('get_labels')(err);
                });
    });

    socket.on('shortest_path', function (pair) {
        graph.take(1)
            .do(function (graph) {
                graph.simulator.highlightShortestPaths(pair);
                animStep.interact({play: true, layout: true});
            })
            .subscribe(_.identity, util.makeRxErrorHandler('shortest_path'));
    });

    socket.on('set_colors', function (color) {
        graph.take(1)
            .do(function (graph) {
                graph.simulator.setColor(color);
                animStep.interact({play: true, layout: true});
            })
            .subscribe(_.identity, util.makeRxErrorHandler('set_colors'));
    });

    socket.on('highlight_points', function (points) {
        graph.take(1)
            .do(function (graph) {

                points.forEach(function (point) {
                    graph.simulator.buffersLocal.pointColors[point.index] = point.color;
                });
                graph.simulator.tickBuffers(['pointColors']);

                animStep.interact({play: true, layout: true});
            })
            .subscribe(_.identity, util.makeRxErrorHandler('highlighted_points'));

    });






    // ============= EVENT LOOP

    //starts true, set to false whenever transfer starts, true again when ack'd
    var clientReady = new Rx.ReplaySubject(1);
    clientReady.onNext(true);
    socket.on('received_buffers', function (time) {
        profiling('Received buffers');
        debug('Client end-to-end time', time);
        clientReady.onNext(true);
    });

    clientReady.subscribe(debug.bind('CLIENT STATUS'), util.makeRxErrorHandler('clientReady'));

    debug('SETTING UP CLIENT EVENT LOOP ===================================================================');
    var step = 0;
    var lastVersions = null;

    graph.expand(function (graph) {
        step++;

        var ticker = {step: step};

        debug('0. Prefetch VBOs', socket.id, activeBuffers, ticker);

        return driver.fetchData(graph, renderConfig, compress,
                                activeBuffers, lastVersions, activePrograms)
            .do(function (vbos) {
                debug('1. prefetched VBOs for xhr2: ' + vboSizeMB(vbos.compressed) + 'MB', ticker);

                //tell XHR2 sender about it
                lastCompressedVbos[socket.id] = vbos.compressed;

                persistor.maybeSaveVbos(vbos, step);

            })
            .flatMap(function (vbos) {
                debug('2. Waiting for client to finish previous', socket.id, ticker);
                return clientReady
                    .filter(_.identity)
                    .take(1)
                    .do(function () {
                        debug('2b. Client ready, proceed and mark as processing.', socket.id, ticker);
                        clientReady.onNext(false);
                    })
                    .map(_.constant(vbos));
            })
            .flatMap(function (vbos) {
                debug('3. tell client about availablity', socket.id, ticker);

                //for each buffer transfer
                var clientAckStartTime;
                var clientElapsed;
                var transferredBuffers = [];
                finishBufferTransfers[socket.id] = function (bufferName) {
                    debug('5a ?. sending a buffer', bufferName, socket.id, ticker);
                    transferredBuffers.push(bufferName);
                    if (transferredBuffers.length === requestedBuffers.length) {
                        debug('5b. started sending all', socket.id, ticker);
                        debug('Socket', '...client ping ' + clientElapsed + 'ms');
                        debug('Socket', '...client asked for all buffers',
                            Date.now() - clientAckStartTime, 'ms');
                    }
                };

                var emitFnWrapper = Rx.Observable.fromCallback(socket.emit, socket);

                //notify of buffer/texture metadata
                //FIXME make more generic and account in buffer notification status
                var receivedAll = colorTexture.flatMap(function (colorTexture) {
                        debug('4a. unwrapped texture meta', ticker);

                        var textures = {
                            colorMap: _.pick(colorTexture, ['width', 'height', 'bytes'])
                        };

                        //FIXME: should show all active VBOs, not those based on prev req
                        var metadata =
                            _.extend(
                                _.pick(vbos, ['bufferByteLengths', 'elements']),
                                {
                                    textures: textures,
                                    versions: {
                                        buffers: vbos.versions,
                                        textures: {colorMap: 1}},
                                    step: step
                                });
                        lastVersions = vbos.versions;

                        debug('4b. notifying client of buffer metadata', metadata, ticker);
                        profiling('===Sending VBO Update===');
                        return emitFnWrapper('vbo_update', metadata);

                    }).do(
                        function (clientElapsedMsg) {
                            debug('6. client all received', socket.id, ticker);
                            clientElapsed = clientElapsedMsg;
                            clientAckStartTime = Date.now();
                        });

                return receivedAll;
            })
            .flatMap(function () {
                debug('7. Wait for next anim step', socket.id, ticker);
                return ticksMulti
                    .take(1)
                    .do(function () { debug('8. next ready!', socket.id, ticker); });
            })
            .map(_.constant(graph));
    })
    .subscribe(function () {
        debug('9. LOOP ITERATED', socket.id);
    }, util.makeRxErrorHandler('Main loop failure'));
}


if (require.main === module) {

    var url     = require('url');

    var express = require('express');
    var proxy   = require('express-http-proxy');

    var app     = express();
    var http    = require('http').Server(app);
    var io      = require('socket.io')(http, {path: '/worker/3000/socket.io'});

    debug('Config set to %j', config);

    var nocache = function (req, res, next) {
        res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.header('Expires', '-1');
        res.header('Pragma', 'no-cache');
        next();
    };
    app.use(nocache);

    var allowCrossOrigin = function  (req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,PATCH,POST,DELETE');
        next();
    };
    app.use(allowCrossOrigin);

    //Static assets
    app.get('*/StreamGL.js', function(req, res) {
        res.sendFile(require.resolve('StreamGL/dist/StreamGL.js'));
    });
    app.get('*/StreamGL.map', function(req, res) {
        res.sendFile(require.resolve('StreamGL/dist/StreamGL.map'));
    });
    app.use('/graph', function (req, res, next) {
        return express.static(path.resolve(__dirname, 'assets'))(req, res, next);
    });

    //Dyn routing
    app.get('/vizaddr/graph', function(req, res) {
        res.json({
            'hostname': config.HTTP_LISTEN_ADDRESS,
            'port': config.HTTP_LISTEN_PORT,
            'timestamp': Date.now()
        });
    });

    io.on('connection', function (socket) {
        init(app, socket);
        socket.on('viz', function (msg, cb) { cb({success: true}); });
    });

    debug('Binding', config.HTTP_LISTEN_ADDRESS, config.HTTP_LISTEN_PORT);
    var listen = Rx.Observable.fromNodeCallback(
            http.listen.bind(http, config.HTTP_LISTEN_PORT, config.HTTP_LISTEN_ADDRESS))();

    listen.do(function () {

        //proxy worker requests
        var from = '/worker/' + config.HTTP_LISTEN_PORT + '/';
        var to = 'http://localhost:' + config.HTTP_LISTEN_PORT;
        debug('setting up proxy', from, '->', to);
        app.use(from, proxy(to, {
            forwardPath: function(req, res) {
                return url.parse(req.url).path.replace(RegExp('worker/' + config.HTTP_LISTEN_PORT + '/'),'/');
            }
        }));



    }).subscribe(
        function () { console.log('\nViz worker listening...'); },
        util.makeRxErrorHandler('server-viz main')
    );

}


module.exports = {
    init: init,
    getState: getState
}
