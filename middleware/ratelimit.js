const rateLimitStore = {}

function getRandomId(){
    return Math.random().toString(36).substr(2, 9);
}

function isRatedLimit(ip){
    if(ip === 'local') return false;

    const now = Date.now();
    const limit = 12;
    const windowMs= 60 * 60 * 1000

    const ipData = rateLimitStore[ip]|| {calls :[]}
    ipData.calls = ipData.calls.filter(call => now - call.timestamp < windowMs )

    rateLimitStore[ip] = ipData;

    if (ipData.calls.length >= limit){
        return true;
    }
    return false;
}

function setupIpTracking (ip){
    if (ip === 'local') return;

    const now = Date.now();
    const newCall = {id:getRandomId(), timestamp:now}

    if(!rateLimitStore[ip]){
        rateLimitStore[ip] = {calls : [newCall]}
    }else{
        rateLimitStore[ip].calls.push(newCall);
    }
}

module.exports = {isRatedLimit, setupIpTracking};