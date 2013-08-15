'use strict';
ViewState.prototype = new ParentingObject();



/**
 * Construct a ViewState.
 * @constructor
 * @param {Object} svg A d3 svg.
 */
function ViewState(svg) {

  // keep the 'real' svg private
  this._svg = svg;
  // get something to grab all the clicks
  this.eventGrabber = this._svg.append('rect')
      .classed('eventGrabber', true)
      .attr('x', 0)
      .attr('y', 0);
  // publish a viewport that we can shift around.
  this.svg = this._svg.append('g');
  this.childSVG = this.svg;

  /* Events */
  // this works fine, contra viewobj.js
  var that = this;
  var dragHandler = d3.behavior.drag()
      .origin(function(d) {
        return {x: -that.position[0], y: -that.position[1]};
      })
      .on('drag', function(d) {
        if (d3.event.sourceEvent.touches &&
            d3.event.sourceEvent.touches.length > 1) {
          return;
        }
        that.moveTo([-d3.event.x, -d3.event.y]);
      });
  this.eventGrabber.call(dragHandler);

  this.eventGrabber.on('click', function() {
    if (that.mouseData.inDropState) {
      that.finishAddingView(d3.mouse(this));
    }
  });

  // ideally replace this with a tap event.
  this.eventGrabber.on('touchstart', function() {
    if (that.mouseData.inDropState &&
        d3.event.touches.length == 1) {
      that.finishAddingView(d3.touches(this)[0]);
    }
  });

  // cannot for the life of me work out what the translate vector represents.
  var oldScale = 1;
  var zoomHandler = d3.behavior.zoom();
  zoomHandler.on('zoom', function(d) {

    // after a drag, this gets invoked at even mouse move, with unchanged
    // scale. we don't want this; it causes wobble. (bug #14)
    // I also have no idea why it gets invoked or how to stop it.
    if (d3.event.scale == oldScale) return;

    var scale = d3.event.scale / oldScale;
    // because the preferred way doesn't work, attempt this to break the
    // double-click thingy
    if (d3.event.sourceEvent.type == 'dblclick' ||
            d3.event.sourceEvent.type == 'touchstart') {
      return;
    }
    if (d3.event.sourceEvent.webkitDirectionInvertedFromDevice) {
      scale = 1 / scale;
    }
    that.zoom(scale, d3.mouse(this));
    oldScale = d3.event.scale;
  });
  //.on('dblclick.zoom',null);
  // ^ doesn't work, despite being what is suggested in
  // http://stackoverflow.com/a/11788800/463510
  // by mbostock himself.

  // Attach the hander to the SVG tag because in this case we do want it
  // to eat all the zoom events.
  this._svg.call(zoomHandler);

  // The downside of the zoom handler is that it eats all the touch
  // events, including the ones contextMenu needs. Massive hack around it.
  this._svg.on('touchstart', function() {
    // FIXME: massive hack
    if (!!window.contextMenuHideEvent) {
      window.contextMenuHideEvent(d3.event);
    }
  });

  // sizing: set so that a trillion dollar thing fits nicely in ~600 pixels.
  this.resizeToWindow();
  var maxOuterRadius = 600 / 2;
  this.scaleMax = tril;
  this.scaleFactor = 1;
  this.scaler = d3.scale.sqrt()
        .domain([0, this.scaleMax]).range([0, maxOuterRadius]);

  this.centreView();

  this.mouseData = {};
  this.mouseData.inDropState = false;

  // zoom
  this.renderTimeout = -1;
}


/**
 * Resize the SVG and event grabbing rectangle to the container size.
 */
ViewState.prototype.resizeToWindow = function() {
  this.width = this._svg[0][0].parentElement.clientWidth;
  // are we in a document or in a div? FIXME: this logic should go elsewhere
  if (this._svg[0][0].parentElement.tagName == 'BODY') {
    // included space for "authorised by"
    this.height = (this._svg[0][0].parentElement.scrollHeight - 30);
  } else {
    this.height = this._svg[0][0].parentElement.clientHeight;
  }

  this._svg.attr('style',
      'width: ' + this.width + 'px; ' +
      'height: ' + this.height + 'px;');

  this.eventGrabber
      .attr('width', this.width)
      .attr('height', this.height);

};


/**
 * Move the ViewState object to the centre of the display
 */
ViewState.prototype.centreView = function() {
  this.moveTo([-this.width / 2, -this.height / 2]);
};


/**
 * Zoom the view
 *
 * @param {number} factor The desired zoom factor,
 *                        relative to the existing zoom.
 * @param {Array.<number>} about The point about which to zoom.
 *                               Pixels relative to top left corner.
 * @param {boolean=} immediate Whether or not to force rendering now or
 *                             allow it to be deferred.
 */
ViewState.prototype.zoom = function(factor, about, immediate) {
  try {
    window.clearTimeout(this.renderTimeout);
  } catch (err) {}

  // we want the dollar value at about to be invariant upon scaling.
  var aboutDollars = [about[0] + this.position[0],
    about[1] + this.position[1]].map(this.scaler.invert);

  this.scaleFactor = this.scaler.invert(this.scaleFactor);

  this.scaleMax /= factor;
  this.scaler = this.scaler.domain([0, this.scaleMax]);

  this.scaleFactor = this.scaler(this.scaleFactor);

  aboutDollars = aboutDollars.map(this.scaler);
  this.position = [aboutDollars[0] - about[0],
    aboutDollars[1] - about[1]];

  var that = this;
  var doRealZoom = function() {
    that.svg.attr('transform',
        'translate(' + -that.position[0] +
                      ',' + -that.position[1] + ')');
    that.children().map(function(child) {
      // zooming changes the scaler. This keeps the pt position up to
      // date with the dollar position.
      var reposition = function(child) {
        child.moveTo(child.position);
        child.children().map(reposition);
        var recenterChild = function(child) {
          child.svg.attr('transform', 'translate(' +
                           -viewstate.scaler(child.boundingCircle.cx) + ',' +
                           -viewstate.scaler(child.boundingCircle.cy) + ')');
          child.children().map(recenterChild);
        };
        // don't apply circle movement to top level,
        // otherwise it bounces around.
        // just apply it to children.
        child.children().map(recenterChild);
      };
      reposition(child);
      child.render();
    });
    that.scaleFactor = 1;
  };

  if (immediate) {
    doRealZoom();
  } else {
    this.svg.attr('transform',
        'translate(' + (-this.position[0] + ',' +
        -this.position[1] + ') ') +
                      'scale(' + this.scaleFactor + ')');
    this.renderTimeout = window.setTimeout(doRealZoom, 50);
  }
};


/**
 * Centre display around an object
 *
 * @param {Object} viewthing Object (viewObj or viewstate) on which to centre
 *                           display.
*/
ViewState.prototype.centreViewOn = function(viewthing) {
  // todo: introduce some semantic consistency around .svg/._svg
  // also we so very badly need test cases.
  if (viewthing instanceof ViewObj) {
    var svg = viewthing._svg[0][0];
  } else {
    var svg = viewthing.svg[0][0];
  }
  var bbox = svg.getBBox();

  // if there is a halo, this process doesn't get it right.  rather
  // than trying to inspect for a halo (which you can do for a viewObj
  // but not for a viewstate, and it makes things horridly
  // implementation specific too), we just iterate until we get the
  // result we expect. This is potentially slow, but oh well!

  while (Math.abs(bbox['height'] - this.height) > 10 &&
         Math.abs(bbox['width'] - this.width) > 10) {

    var doesHeightLimit =
        ((this.height / bbox.height) < (this.width / bbox.width)) ?
        true : false;

    if (doesHeightLimit) {
      var scaleFactor = (this.scaler.invert(this.height / 2)) /
          this.scaler.invert(bbox.height / 2);
    } else {
      var scaleFactor = (this.scaler.invert(this.width / 2)) /
          this.scaler.invert(bbox.width / 2);
    }

    this.zoom(scaleFactor, [0, 0], true);
    bbox = svg.getBBox();
  }

  var xpos = bbox.x;
  var ypos = bbox.y;
  var obj = viewthing;
  while (!(obj instanceof ViewState)) {
    xpos += this.scaler(obj.position[0]);
    ypos += this.scaler(obj.position[1]);
    obj = obj.parent;
  }

  this.moveTo([xpos - (this.width - bbox.width) / 2,
        ypos - (this.height - bbox.height) / 2]);
};

/**
 * Move the viewport so that we're looking at the given position.
 *
 * @param {Position} position Array of x,y location.
 */
ViewState.prototype.moveTo = function(position) {
  this.position = position;
  this.svg.attr('transform',
      'translate(' + (-this.position[0] + ',' +
      -this.position[1]) + ')');
};

/**
 * Offset the viewport by the position vector given.
 *
 * @param {Position} position Array of x,y location as offset.
 */
ViewState.prototype.move = function(position) {
  this.position[0] += position[0];
  this.position[1] += position[1];
  this.moveTo(this.position);
};

/**
 * What periods are available to display by at least one ViewObj?
 * @return {Array.<string>} Valid periods for 1+ ViewObjs.
 */
ViewState.prototype.availablePeriods = function() {
  var allPeriods = this.children().map(function(child) {
    return child.availablePeriods();
  });
  var result = allPeriods.reduce(function(prev, curr) {
    for (var x in curr) {
      var found = false;
      for (var i = 0; i < prev.length; i++) {
        if (curr[x] == prev[i]) {
          found = true;
          break;
        }
      }
      if (!found) prev.push(curr[x]);
    }
    return prev;
  }, []);
  result.sort();
  return result;
};

/**
 * repositionChildren stub
 *
 */
ViewState.prototype.repositionChildren = function() {};

/**
 * Begin process to add view data
 *
 * @param {Object} data Dropped data to view.
 * @param {string} period The period to set for the new entity.
 */
ViewState.prototype.beginAddingView = function(data, period) {
  this._addingData = data;
  this._addingPeriod = period;
  this.mouseData.inDropState = true;
};

/**
 * Finish adding a new entity to the viewstate, now that we know its
 * position.
 *
 * @param {Position} position Array of x,y location as offset.
 */
ViewState.prototype.finishAddingView = function(position) {

  position[0] += this.position[0];
  position[1] += this.position[1];

  position = position.map(this.scaler.invert);

  var vo = new ViewObj(this._addingData, this, position);
  vo.period(this._addingPeriod);
  vo.render();

  this.mouseData.inDropState = false;

  // UI Callback
  hasPlacedEntity();
};


/**
 * Cancel the process of adding a view
 */
ViewState.prototype.cancelAddingView = function() {
  this._addingData = null;
  this.mouseData.inDropState = false;
};


/**
 * Update the infobox, either with a new viewObj/callback object, or
 * the old one (presumably with an updated period).
 *
 * @param {ViewObj=} opt_viewobj Use the given viewobj.
 * @param {Object=} opt_callback_data Use the given callback object.
 */
ViewState.prototype.updateInfobox = function(opt_viewobj, opt_callback_data) {
  if (opt_viewobj !== undefined) {
    this.infoboxViewObj = opt_viewobj;
    this.infoboxCallbackData = opt_callback_data;
  }
  if (!this.infoboxViewObj) return;
  jQuery('#infobox').html(this.infoboxViewObj.info(this.infoboxCallbackData));
};


/** Export the current state
 * @return {Object} A representation of the current state.
 */

ViewState.prototype.exportState = function() {
  var viewObjState = function(viewObj) {
    var state = {};
    if ('_id' in viewObj.data()) {
      state['entityId'] = viewObj.data()['_id']['$oid'];
    } else if (viewObj.parent instanceof ViewState) {
      // oh dear, an ephemeral
      throw new Exception('Ephemeral!');
    }

    state['position'] = viewObj.position;
    state['specifiedAggregates'] = viewObj.renderMode.specifiedAggregates;

    var children = viewObj.children();
    if (children.length) state['children'] = [];
    for (child in children) {
      state['children'].push(viewObjState(children[child]));
    }

    return state;
  };

  var state = {};
  if (viewstate.children().length == 0) {
    alert('You can\'t export an empty setup.');
    return undefined;
  }

  // this breaks the abstraction. FIXME
  state['period'] = jQuery('#period').text();
  state['viewcenter'] = [viewstate.position[0] + viewstate.width / 2,
                         viewstate.position[1] + viewstate.height / 2];
  state['scaleMax'] = viewstate.scaleMax;

  state['children'] = [];
  var children = viewstate.children();
  for (var child in children) {
    try {
      state['children'].push(viewObjState(children[child]));
    } catch (e) {
      alert(children[child].data()['name'] + ' cannot be saved because it is' +
            ' not saved in the database. Please log in, upload it to the ' +
            'database using "Manage data", and then try again.');
      return undefined;
    }
  }

  return state;
};

/** Import a state
 * @param {Object} state A representation of the state to import.
 */

ViewState.prototype.importState = function(state) {
  // I feel somewhat dirty having network code here. Not sure about
  // the best way to get around this. Move it to events.js and
  // abstract it?

  // this has many spurious render/repositions. FIXME

  var that = this;

  var createChildren = function(viewObj, voState) {
    if ('children' in voState && voState['children'].length) {
      viewObj.popOut();
      viewObj.reposition();
      viewObj.render();
      for (var child in voState.children) {
        createChildren(viewObj.children()[child], voState.children[child]);
      }
    }
  };

  var updateChild = function(viewObj, voState) {
    viewObj.moveTo(voState['position']);
    if (!('children' in voState)) return;
    for (var child in voState.children) {
      updateChild(viewObj.children()[child], voState.children[child]);
    }
  };

  var createTopLevelEntity = function(voState, globalState) {
    // deal with MongoDB/Engine cruft
    if ('$oid' in children[child]['entityId']) {
      var id = children[child]['entityId']['$oid'];
    } else {
      var id = children[child]['entityId'];
    }
  getEntity(
    id,
    function(d) {
      var vo = new ViewObj(d, that, voState['position']);
      vo.period(globalState['period']);
      vo.renderMode.specifiedAggregates = voState['specifiedAggregates'];
      vo.render();
      vo.reposition();
      if ('children' in voState && voState['children'].length) {
        vo.popOut();
        vo.reposition();
        vo.render();
        for (var child in voState['children']) {
          createChildren(vo.children()[child],
                         voState['children'][child]);
        }
      }

      // reposition here - sets bounding circle.
      vo.reposition();
      vo.render();

      if ('children' in voState && voState['children'].length) {
        for (var child in voState['children']) {
        updateChild(vo.children()[child],
              voState['children'][child]);
        }
      }
    },
    function() {
      // this code breaks abstraction and needs to be moved out
      // (it assumes things about the environment - that event.js is
      // normal - that it shouldn't do; potentially breaking embedding.)
      updatePeriodSelector();
      var period = globalState['period'];
      jQuery('#periodSel option[value=' + period + ']')
        .prop('selected', true);
      jQuery('#period').text(period);
    });
  };

  this.scaleMax = state['scaleMax'];
  this.zoom(1, [0, 0], true);
  this.moveTo([state['viewcenter'][0] - this.width / 2,
               state['viewcenter'][1] - this.height / 2]);

  var children = state['children'];
  for (var child in children) {
    createTopLevelEntity(children[child], state);
  }


};
