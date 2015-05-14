/*
The MIT License (MIT)

Copyright (c) 2014 Shazron Abdullah

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

var path = require('path'),
    fs = require('fs'),
    help = require('./help'),
    util = require('util'),
    simctl,
    bplist;
    
function findRuntimesGroupByDeviceProperty(list, deviceProperty, availableOnly) {
    /*
        // Example result:
        {
            "iPhone 6" : [ "iOS 8.2", "iOS 8.3"],
            "iPhone 6 Plus" : [ "iOS 8.2", "iOS 8.3"]
        } 
    */
    
    var runtimes = {};
    var available_runtimes = {};
    
    list.runtimes.forEach(function(runtime) {
        if (runtime.available) {
            available_runtimes[ runtime.name ] = true;
        }
    });
    
    list.devices.forEach(function(deviceGroup) {
        deviceGroup.devices.forEach(function(device){
            var devicePropertyValue = device[deviceProperty];
            
            if (!runtimes[devicePropertyValue]) {
                runtimes[devicePropertyValue] = [];
            }
            if (availableOnly) {
                if (available_runtimes[deviceGroup.runtime]) {
                    runtimes[devicePropertyValue].push(deviceGroup.runtime);
                }
            } else {
                runtimes[devicePropertyValue].push(deviceGroup.runtime);
            }
        });
    });
    
    return runtimes;
}

function findAvailableRuntime(list, device_name) {

    var all_druntimes = findRuntimesGroupByDeviceProperty(list, "name", true);
    var druntime = all_druntimes[device_name];
    var runtime_found = druntime && druntime.length > 0;

    if (!runtime_found) {
        console.error(util.format('No available runtimes could be found for "%s".', device_name));
        process.exit(1);
    }
    
    // return most modern runtime
    return druntime.sort().pop();
}

function processDeviceTypeId(devicetypeid) {
    
    // the object to return
    var ret_obj = {
        name : null,
        id : null,
        runtime : null
    };
    
    var arr = [];
    if (devicetypeid) {
        arr = devicetypeid.split(',');
    }
    
    // get the devicetype from --devicetypeid
    // --devicetypeid is a string in the form "devicetype, runtime_version" (optional: runtime_version)
    if (arr.length < 1) {
      console.error('--devicetypeid was not specified.');
      process.exit(1);
    }

    var devicetype = arr[0].trim();
    if (arr.length > 1) {
        ret_obj.runtime = arr[1].trim();
    }
    
    // check whether devicetype has the "com.apple.CoreSimulator.SimDeviceType." prefix, if not, add it
    var prefix = 'com.apple.CoreSimulator.SimDeviceType.';
    if (devicetype.indexOf(prefix) != 0) {
        devicetype = prefix + devicetype;
    }
    
    // now find the devicename from the devicetype
    var options = { 'silent': true };
    var list = simctl.list(options).json;
    
    var devicename_found = list.devicetypes.some(function(deviceGroup) {
        if (deviceGroup.id === devicetype) {
            ret_obj.name = deviceGroup.name;
            return true;
        }
        
        return false;
    });
    
    // device name not found, exit
    if (!devicename_found) {
      console.error(util.format('Device type "%s" could not be found.', devicetype));
      process.exit(1);
    }
    
    // if runtime_version was not specified, we use a default. Use first available that has the device
    if (!ret_obj.runtime) {
        ret_obj.runtime = findAvailableRuntime(list, ret_obj.name);
    }
    
    // prepend iOS to runtime version, if necessary
    if (ret_obj.runtime.indexOf('iOS') === -1) {
        ret_obj.runtime = util.format('iOS %s', ret_obj.runtime);
    }
    
    // now find the deviceid (by runtime and devicename)
    var deviceid_found = list.devices.some(function(deviceGroup) {
        if (deviceGroup.runtime === ret_obj.runtime) { // found the runtime, now find the actual device matching devicename
            return deviceGroup.devices.some(function(device) {
                if (device.name === ret_obj.name) {
                    ret_obj.id = device.id;
                    return true;
                }
                return false;
            });
        }
        return false;
    });
    
    if (!deviceid_found) {
        console.error(util.format('Device id for device name "%s" and runtime "%s" could not be found, or is not available.', ret_obj.name, ret_obj.runtime));
        process.exit(1);
    }
    
    return ret_obj;
}

var command_lib = {
    
    init : function() {
        if (!simctl) {
            simctl = require('simctl');
        }
        var output = simctl.check_prerequisites();
        if (output.code !== 0) {
            console.error(output.output);
            process.exit(2);
        }
        
        if (!bplist) {
            bplist = require('bplist-parser');
        }
    },
    
    showsdks : function(args) {
        var options = { 'runtimes' : true };
        simctl.list(options);
    },
    
    showdevicetypes : function(args) {
        var options = { silent: true };
        var list = simctl.list(options).json;
        
        var druntimes = findRuntimesGroupByDeviceProperty(list, "name", true);
        var name_id_map = {};
        
        list.devicetypes.forEach(function(device) {
            name_id_map[ device.name ] = device.id;
        });
        
        for (var deviceName in druntimes) {
            var runtimes = druntimes[ deviceName ];
            runtimes.forEach(function(runtime){
                // remove "iOS" prefix in runtime, remove prefix "com.apple.CoreSimulator.SimDeviceType." in id
                console.log(util.format("%s, %s", name_id_map[ deviceName ].replace(/^com.apple.CoreSimulator.SimDeviceType./, ''), runtime.replace(/^iOS /, '')));
            });
        }
    },
    
    launch : function(args) {
        var wait_for_debugger = false,
            app_identifier,
            argv,
            app_path,
            info_plist_path;

        if (args.argv.remain.length < 2) {
            help();
            process.exit(1);
        }
        
        app_path = args.argv.remain[1];
        info_plist_path = path.join(app_path,'Info.plist');
        if (!fs.existsSync(info_plist_path)) {
            console.error(info_plist_path + " file not found.");
            process.exit(1);
        }
        
        bplist.parseFile(info_plist_path, function(err, obj) {
          
            if (err) {
              throw err;
            }

            app_identifier = obj[0].CFBundleIdentifier;
            argv = args.args || [];

            // get the deviceid from --devicetypeid
            // --devicetypeid is a string in the form "devicetype, runtime_version" (optional: runtime_version)
            var device = processDeviceTypeId(args.devicetypeid);
            
            // so now we have the deviceid, we can proceed
            simctl.extensions.start(device.id);
            simctl.install(device.id, app_path);
            simctl.launch(wait_for_debugger, device.id, app_identifier, argv);
            simctl.extensions.log(device.id, args.log);
            if (args.exit) {
                process.exit(0);
            }
        });
    },
    
    start : function(args) {
        var device = {};
        try  {
            device = processDeviceTypeId(args.devicetypeid);
        } catch (e) {
            // do nothing
        }
        
        simctl.extensions.start(device.id);
    }
}

module.exports = command_lib;

