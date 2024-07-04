function cleanPhoneNumber(phoneNumber) {

    return phoneNumber.replace(/62|@.*$/g, '');

}
module.exports = cleanPhoneNumber;