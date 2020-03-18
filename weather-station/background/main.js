const Wappsto = require("wapp-api");
const networkInfo = require("./networkInfo.json");
const netatmo = require("./netatmo");

const wappsto = new Wappsto();

let network, data;
// Timer used for updating data
let updateTimer;
// 5 min
let timeInterval = 300000;

const statusMessage = {
  success_convert_netatmo_data:
    "Succesfully converted Netatmo data to Wappsto UDM",
  error_convert_wappsto_data: "Failed to convert Wappsto data",
  success_update_netatmo_data: "Succesfully updated Wappsto data",
  error_update_wappsto_data: "Failed to update Wappsto data"
};

wappsto
  .get(
    "data",
    {},
    {
      expand: 1,
      subscribe: true
    }
  )
  .then(collection => {
    data = collection.first();

    if (data) {
      if (!data.get("accessToken")) {
        netatmo
          .getAccessToken()
          .then(response => {
            if (response) {
              data.save(
                {
                  accessToken: response.data.access_token,
                  refreshToken: response.data.refresh_token,
                  expiresIn: response.data.expires_in
                },
                {
                  patch: true,
                  success: () => {
                    startWapp();
                  },
                  error: () => {
                    console.log("Error saving access tokens to Wappsto data..");
                  }
                }
              );
            }
          })
          .catch(error => {
            console.log(`Could not get access token: ${error}`);
          });
      } else {
        startWapp();
      }
    }
  })
  .catch(error => {
    console.log(`Could not get Wappsto data: ${error}`);
  });

// If the Netatmo Weather Station network does not already exist, start the conversion process
const startWapp = () => {
  wappsto
    .get(
      "network",
      { name: "Netatmo Weather Station" },
      {
        expand: 5,
        subscribe: true
      }
    )
    .then(collection => {
      if (collection.length > 0) {
        network = collection.first();
        // Update the Weather Station network with the most recent data
        updateStationData();
      } else {
        // Get the users station data with which to populate the new Weather Station network
        netatmo
          .getStationData(data.get("accessToken"))
          .then(response => {
            if (response) {
              convertNetatmoDataToWappstoUDM(response);
            } else {
              // If response is null then refresh tokens and try to start Wapp again
              refreshTokens(startWapp);
            }
          })
          .catch(error => {
            console.log(`Could not get station data: ${error}`);

            updateWappstoData({
              status_message: statusMessage.error_convert_wappsto_data
            });
          });
      }
    })
    .catch(error => {
      console.log(`Could not get Netatmo Weather Station network: ${error}`);
    });
};

// Convert the users data from the Netatmo API into the Wappsto UDM
const convertNetatmoDataToWappstoUDM = response => {
  // Create the Netatmo Weather Station network
  network = createNetwork();
  // Data of the Main Module - every station has this device
  let deviceData = response.data.body.devices;

  let stationName = deviceData[0].station_name;
  // Saving station name to display in the FG
  if (data.get("stationName") !== stationName) {
    updateWappstoData({ stationName: stationName });
  }

  addDevicesToNetwork(deviceData);
  // Data of the modules associated with the Main Module
  let moduleData = response.data.body.devices[0].modules;

  addDevicesToNetwork(moduleData);
  // Saving network
  saveNetwork();

  updateWappstoData({
    status_message: statusMessage.success_convert_netatmo_data
  });
};

// Update station data
const updateStationData = () => {
  // Clear update timer
  if (updateTimer) {
    clearInterval(updateTimer);
  }

  netatmo
    .getStationData(data.get("accessToken"))
    .then(response => {
      if (response) {
        let deviceData = response.data.body.devices;
        // Saving station name to display in the FG
        let stationName = deviceData[0].station_name;

        if (data.get("stationName") !== stationName) {
          updateWappstoData({ stationName: stationName });
        }

        let devices = network.get("device");
        // Handling the update of Main module
        let mainModuleDevice = devices.at(0);

        let valuesToUpdate = mainModuleDevice.get("value");

        valuesToUpdate.forEach(valueToUpdate => {
          let reportState = valueToUpdate.get("state").find({ type: "Report" });
          // deviceData[0] refers to the data of the Main Module
          let newData = deviceData[0].dashboard_data
            ? deviceData[0].dashboard_data[valueToUpdate.get("name")]
            : 0;

          if (reportState.get("data") !== newData) {
            reportState.save({ data: newData.toString() }, { patch: true });
          }
        });
        // Handling the update of smaller modules
        if (devices.length > 1) {
          // Omitting device at index 0 because it is always going to be Main Module by design
          for (let i = 1; i < devices.length; i++) {
            let currentDevice = devices.at(i);

            let moduleData = response.data.body.devices[0].modules;

            moduleData.forEach(module => {
              // Matching the current device with its corresponding module data
              if (currentDevice.get("name") === module.module_name) {
                let valuesToUpdate = currentDevice.get("value");

                valuesToUpdate.forEach(valueToUpdate => {
                  let reportState = valueToUpdate
                    .get("state")
                    .find({ type: "Report" });

                  let newData = module.dashboard_data
                    ? module.dashboard_data[valueToUpdate.get("name")]
                    : 0;

                  if (reportState.get("data") !== newData) {
                    reportState.save(
                      { data: newData.toString() },
                      { patch: true }
                    );
                  }
                });
              }
            });
          }
          // Main Module device and smaller modules are updated
          setUpdateTimer();

          updateWappstoData({
            status_message: statusMessage.success_update_netatmo_data
          });
        } else {
          // Main Module device is updated
          setUpdateTimer();

          updateWappstoData({
            status_message: statusMessage.success_update_netatmo_data
          });
        }
      } else {
        // If response is null then refresh tokens and try to update data again
        refreshTokens(updateStationData);
      }
    })
    .catch(error => {
      console.log("Could not get station data: " + error);

      updateWappstoData({
        status_message: statusMessage.error_update_wappsto_data
      });

      refreshTokens(updateStationData);
    });
};

// Set timer used to update station data
const setUpdateTimer = () => {
  if (updateTimer) {
    clearInterval(updateTimer);
  }
  updateTimer = setInterval(() => {
    updateStationData();
  }, timeInterval);
};

// Create and return network
const createNetwork = () => {
  let newNetwork = new wappsto.models.Network();

  newNetwork.set("name", networkInfo.name);

  return newNetwork;
};

// Create and return device
const createDevice = deviceData => {
  let newDevice = new wappsto.models.Device();

  // Device type is used to differentiate between the Main Module and the other modules
  // Thus the right attributes can be set for each case
  if (deviceData.type === "NAMain") {
    newDevice.set({
      name: deviceData.module_name,
      description: networkInfo.device[0].description,
      manufacturer: networkInfo.device[0].manufacturer,
      communication: networkInfo.device[0].communication
    });
  } else {
    newDevice.set({
      name: deviceData.module_name,
      description: "Module device",
      manufacturer: networkInfo.device[0].manufacturer,
      communication: networkInfo.device[0].communication
    });
  }
  return newDevice;
};

// Create and return device value
const createValue = (dataType, device) => {
  let newValue = new wappsto.models.Value();

  networkInfo.device[0].value.forEach(value => {
    if (value.param === dataType) {
      newValue.set({
        name: value.name,
        type: value.type,
        permission: value.permission,
        dataType: value.dataType,
        // all the values are of type number
        number: {
          min: value.min ? parseInt(value.min) : -999,
          max: value.max ? parseInt(value.max) : 999,
          step: value.step ? parseInt(value.step) : 1,
          unit: value.unit
        },
        description: value.description
      });

      if (newValue) {
        // if the device is unreachable then device.dashboard_data will be missing
        let stateData = device.dashboard_data
          ? device.dashboard_data[value.param]
          : 0;
        // all the value permissions are of type Report
        let reportState = createState("Report", stateData);

        newValue.get("state").push(reportState);
      }
    }
  });
  return newValue;
};

// Create and return value state
const createState = (type, data) => {
  let newState = new wappsto.models.State();

  let timestamp = new Date().toISOString();

  newState.set({
    type: type,
    data: data.toString(),
    timestamp: timestamp
  });

  return newState;
};

// Save network and set update timer
const saveNetwork = () => {
  network.save(
    {},
    {
      subscribe: true,
      success: () => {
        if (updateTimer) {
          clearInterval(updateTimer);
        }
        setUpdateTimer();
      },
      error: error => {
        console.log(error);
      }
    }
  );
};

// Save and update data to wappsto data model
const updateWappstoData = dataToUpdate => {
  data.set(dataToUpdate);
  data.save(dataToUpdate, {
    patch: true,
    error: () => {
      console.log("Error saving Wappsto data..");
    }
  });
};

// Use device data to create device, values and state and then add device to the network
const addDevicesToNetwork = deviceData => {
  deviceData.forEach(device => {
    let deviceToAdd = createDevice(device);
    if (deviceToAdd) {
      let deviceDataTypes = device.data_type;

      deviceDataTypes.forEach(dataType => {
        let valueToAdd = createValue(dataType, device);

        deviceToAdd.get("value").push(valueToAdd);
      });
      network.get("device").push(deviceToAdd);
    }
  });
};

// Refresh tokens if unable to get station data
const refreshTokens = callback => {
  netatmo
    .getRefreshToken(data.get("refreshToken"))
    .then(response => {
      if (response) {
        data.save(
          {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresIn: response.data.expires_in
          },
          {
            patch: true,
            success: () => {
              // Execute callback
              callback();
            },
            error: () => {
              console.log("Error saving access tokens to Wappsto data..");
            }
          }
        );
      }
    })
    .catch(error => {
      console.log("Could not refresh tokens: " + error);
    });
};
