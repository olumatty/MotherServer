const aircodes = require('aircodes');

const getIataCodeFromCity = (cityName) => {
    const allAirports = aircodes.getAllAirports();
    
    const exactCityMatch = allAirports.find(airport => 
        airport.city && airport.city.toUpperCase() === cityName.toUpperCase()
    );
    
    if (exactCityMatch) return exactCityMatch.iata;
    
    const nameMatch = allAirports.find(airport => 
        airport.name && airport.name.toUpperCase().includes(cityName.toUpperCase())
    );
    
    return nameMatch ? nameMatch.iata : null;
};

module.exports = {
    ...aircodes,
    getIataCodeFromCity
};