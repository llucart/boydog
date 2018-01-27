//BoyDog server-side module

'use strict';

module.exports = function(server) {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({ server });
  var _ = require('lodash');
  var scope = {};
  var logic = {};
  
  //
  //Utility classes
  //
  
  var canonicalizePath = function(str) {
    var attr = _.toPath(str);
    
    if (attr.length > 1) {
      attr = _.map(attr, function(item, i) {
        if (i === 0) return item;
        
        if((item[0] === "#") || ((item[0] === "."))) return item;
          
        return "'" + item + "'";
      })
      
      attr = attr.shift() + "[" + attr.join("][") + "]";
    } else {
      attr = attr.shift();
    }
    
    return attr;
  }
  
  //
  //Boy functions
  //
  
  //Assign boy's data and logic
  var assign = function(_scope, _logic) {
    if (_scope) scope = _scope;
    if (_logic) logic = _logic;
  }
  
  /*//dog-run currently disabled
  var run = function(data) {
    var mask = _.get(logic, data.path);
      
    if (mask === null) return;
    
    if (mask !== undefined) {
      if (mask.__run) return mask.__run(data);
    }
  }*/
  
  /*//Not used (may be included in newer versions)
  var forwardPropagate = function(startPoint) {
    var sp;
    var keysArray = [];
    
    if (!startPoint || (startPoint === ".")) {
      sp = scope;
    } else {
      sp = _.get(scope, startPoint);
    }
    
    function walkKeys(val, key, subPath) {
      var tmpArr = subPath.slice();
      if (key) tmpArr.push(key);
      
      //if (!_.isArray(keysArray[tmpArr.length])) keysArray[tmpArr.length] = [];
      //keysArray[tmpArr.length].push(tmpArr);
      
      _.each(val, function(v, k) {
        if (_.isObject(v) || _.isArray(v)) {
          return walkKeys(v, k, tmpArr);
        }
        
        //if (!_.isArray(keysArray[tmpArr.length + 1])) keysArray[tmpArr.length + 1] = [];
        //keysArray[tmpArr.length + 1].push(tmpArr);
      })
    }
    
    walkKeys(sp, undefined, []);
  }*/
  
  var give = function(bone) {
    var mask;
    var tmpPath;
    
    //Execute the last item __give
    mask = _.get(logic, bone.path);
    
    if (mask === null) return;
    
    if (mask !== undefined) {
      if (mask.__give === null) return;
      if (mask.__give) bone = mask.__give(bone);
    }
    
    if (bone === undefined) return;
    
    //Execute middleware functions to the actual value
    var fullPath = _.toPath(bone.path);
    for (var i = 1; i < fullPath.length; i++) { //Note that we *don't* take the very last item, as this item is not part of the middleware
      //tmpPath = _.take(fullPath, i); //Verse
      tmpPath = _.take(fullPath, (fullPath.length - i)); //Inverse
      
      mask = _.get(logic, tmpPath);
      
      if (mask === null) return;
      if (mask === undefined) continue;
      
      //TODO: Implement __givetake middleware
      
      if (logic.__give === null) return;
      if (mask.__give) bone = mask.__give(bone);
    }
    
    if (bone === undefined) return;
    
    //Execute logic top level middleware
    if (logic === null) return;
    
    if (logic !== undefined) {
      //TODO: Implement __givetake middleware
      
      if (logic.__give === null) return;
      if (logic.__give) bone = logic.__give(bone);
    }
    
    /*if (!bone.plays) {
      bone.plays = 1;
    } else {
      bone.plays++;
    }*/
    
    if (bone === undefined) return;
    
    bone.socket.send(JSON.stringify(_.omit(bone, 'socket'))); //Remove socket info and send bone to the client
  }
  
  var take = function(bone) {
    var mask;
    var tmpPath;
    
    //Execute logic top level middleware
    if (logic === null) return;
    if (logic !== undefined) {
      //TODO: Implement __givetake middleware
      
      if (logic.__take === null) return;
      if (logic.__take) bone = logic.__take(bone);
    }
    
    if (bone === undefined) return;
    
    //Execute path to the actual value middleware
    var fullPath = _.toPath(bone.path);
    for (var i = 1; i < fullPath.length; i++) { //Note that we *don't* take the very last item, as this item is not part of the middleware
      tmpPath = _.take(fullPath, i); //Verse
      //tmpPath = _.take(fullPath, (fullPath.length - i)); //Inverse
      
      mask = _.get(logic, tmpPath);
      
      if (mask === null) return;
      if (mask === undefined) continue;
      
      //TODO: Implement __givetake middleware
      
      if (mask.__take === null) return;
      if (mask.__take) bone = mask.__take(bone);
    }
    
    if (bone === undefined) return;
    
    bone.final = true;
    
    //Execute the last item __take
    mask = _.get(logic, bone.path);
    
    if (mask === null) return;
    
    if (mask !== undefined) {
      if (mask.__take === null) return;
      if (mask.__take) bone = mask.__take(bone);
    }
    
    if (bone === undefined) return;
    
    if (bone.val === undefined) { //When only asking for a value
      bone.val = _.get(scope, bone.path); //Get value from scope
      if (bone.val !== undefined) give(_.pick(bone, ['path', 'val', 'socket'])); //Give the bone only if it has a value
    } else { //When writing a value
      _.set(scope, bone.path, bone.val); //Set the value
      
      if (bone.socket) { //If the call comes from a user client
        give({ path: bone.path, socket: bone.socket }) //A bone without val is used to get the field value
        
        wss.broadcast(JSON.stringify({ path: bone.path }), bone.socket); //Inform all users that they need to update this value (a bone without val indicates the client should ask for a val)
      } else { //Else, the call does not come from a user client
        wss.broadcast(JSON.stringify({ path: bone.path })); //Refresh the specific route
      }
    }
  }
  
  //Will give a bone without val to all connected users so that they request an update on that path (or on all paths)
  var refresh = function(paths) {
    if (_.isString(paths)) { //If paths is in fact only a single path
      wss.broadcast(JSON.stringify({ path: canonicalizePath(paths) })); //Refresh the specific route
    } else if (_.isArray(paths)) {
      _.each(paths, function(path) { //For each route
        wss.broadcast(JSON.stringify({ path: canonicalizePath(path) })); //Refresh the specific route
      })
    } else {
      //TODO //io.emit('refresh'); //Refresh all routes (careful, this is expensive)
    }
  }
  
  //
  //WebSocket events and functions
  //
  
  //Broadcast to all or to all except a specific client
  wss.broadcast = function broadcast(data, except) {
    wss.clients.forEach(function each(client) {
      if (client !== except && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  };
  
  wss.on('connection', function connection(socket) {
    //const location = url.parse(req.url, true);
    //You might use location.query.access_token to authenticate or share sessions or req.headers.cookie (see http://stackoverflow.com/a/16395220/151312)
   
    socket.on('message', function incoming(bone) {
      var bone = JSON.parse(bone);
      console.log(bone, typeof bone);
      
      bone.socket = socket;
      take(bone);
    });
    
    socket.on('error', function (err) {
      if (err.code !== 'ECONNRESET') {
        //Ignore ECONNRESET, throw all else
        throw err;
      }
    })
  });
  
  //Module exposed functions
  return {
    assign: assign,
    give: give,
    take: take,
    refresh: refresh
  }
};