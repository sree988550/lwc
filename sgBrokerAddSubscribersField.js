import { LightningElement, api, track } from 'lwc';
import pubsub from 'vlocity_ins/pubsub';
import { dataFormatter } from 'vlocity_ins/insUtility';

const dependentOptions = [   
    {value: 'Spouse', label: 'Spouse'}, 
    {value: 'Domestic Partner', label: 'Domestic Partner'},
    {value: 'Child', label: 'Child'},
    {value: 'Over-age Disabled Dependent', label: 'Over-age Disabled Dependent'}
];

const dataTypeKeys = {
    string: 'isText',
    stringNum: 'isTextNum',
    textarea: 'isTextarea',
    boolean: 'isCheckbox',
    double: 'isNumber',
    percent: 'isPercent',
    currency: 'isCurrency',
    date: 'isDate',
    datetime: 'isDatetime',
    time: 'isTime',
    email: 'isEmail',
    phone: 'isPhone',
    url: 'isUrl',
    reference: 'isDropdown',
    picklist: 'isDropdown',
    encryptedstring: 'isText',
    multipicklist: 'isMultiPicklist',
    lookup: 'isLookUp',
    radio: 'isRadio',
    isRelationshipDropdown: 'isRelationshipDropdown'
};

export default class SgBrokerAddSubscribersField extends LightningElement {
    @api theme = 'slds';
    @api currency = dataFormatter.currency;
    @api channel;
    @api fromNcs;
    @api effectiveDate;

    @track cobraChecked = false;
    @track medicareChecked = false;
    @track serviceAreaChecked = false;

    Title = '';
    labels = {
        InsOSCobra: 'Cobra',
        InsMedicare: 'Medicare',
        ToogleTitle: '',
    };
    hideElement = false;
    showOrElement = false;
    isAgeField = false;

    @api
    get field() {
        return this._field;
    }

    set field(data) {
        console.log('data::'+JSON.stringify(data));
        this._field = JSON.parse(JSON.stringify(data));
        this.value = this._field.value;
        this.iszipcode = this._field.isZipCode;
        this.isReadonly = !this._field.isUpdateable;
        let dataType = this._field.dataType.toLowerCase();
        // FIRST NAME, LAST NAME, RELATIONSHIP, ZIP CODE
        if (this._field.fieldName == 'vlocity_ins__FirstName__c'
            || this._field.fieldName == 'vlocity_ins__LastName__c'
            || this._field.fieldName == 'Zip_Code__c'
            || this._field.fieldName == 'Relationship__c') {//deepti
            let fieldLabel = this._field.label;
            this._field.label = fieldLabel.toUpperCase();
            this._field.isRequired = true;
        }
        // BIRTHDATE
        if (this._field.fieldName == 'vlocity_ins__Birthdate__c') {
            this._field.label = 'DATE OF BIRTH mm/dd/yyyy';
            this._field.dataType = 'DATE';
            this.value = this.value ? new Date(this._field.value) : null;
            // Conditional to handle for UTC fix
            if (this.value != null) {
                let dt = new Date(new Date(this._field.value).setHours(new Date(this._field.value).getHours() + 10));
                this.value = dt;
            }
            this._field.isRequired = true;
            this.isBirthDate = true;
            !this._field.fromNcsMember ? this.setBirthdateAttributes({field: this._field, name: 'birthdate'}) : null;
        } else {
            this.isBirthDate = false;
        } 
        // RELATIONSHIP
        if (this._field.label == 'Relationship' && this._field.fieldName != 'Relationship__c') {
            this._field.value = this.value === false ? 'false' : this.value;
            this.isRelationshipField = true;
            this._field.label = 'RELATIONSHIP TYPE';
        } else {
            this.isRelationshipField = false;
        }
        if (this._field.fieldName == 'Relationship__c') {
            this._field.label = 'RELATIONSHIP TYPE';
        }
        // AGE
        if (this._field.fieldName == 'Age__c') {
            this._field.isRequired = false;
            this._field.label = 'AGE (AS OF EFFECTIVE DATE)';
            this.isAge = true;
            this.isReadonly = true;
            dataType = 'stringNum';
            this.isAgeField = true;
            !this._field.fromNcsMember ? this.setAgeAttributes({field: this._field, name: 'age'}) : this.isReadonly = true;
        } else {
            this.isAge = false;
        }
        // MIDDLE INITIAL
        if (this._field.fieldName === 'Middle_Initial__c') {
            this._field.isRequired = false;
            this._field.label = 'MIDDLE INITIAL';
        }
        // PHYSICAL ASSERTION
        if (this._field.fieldName === 'Physical_Assertion__c' && this._field.invalidZip === true) {
            this.hideElement = true;
        } else if (this._field.fieldName === 'Physical_Assertion__c' && this._field.invalidZip === false) {
            this.hideElement = false;
        }
        if (this._field.fieldName === 'Physical_Assertion__c' && !this.fromNcs) {
            this.hideElement = false;
        }
        // SET TYPE, GLOBAL
        const dataTypeKey = dataTypeKeys[dataType];
        this[dataTypeKey] = true;
        if (this.isTime && this.value) {
            // salesforce returns time values as 'HH:mm:ss.SSS ZZ' but timepicker element expects 'HH:mm'
            const date = new Date('1970-01-01T' + this._field.value);
            const hours = date.getUTCHours();
            const minutes = date.getUTCMinutes();
            this.value = `${hours < 10 ? '0' : ''}${hours}:${minutes < 10 ? '0' : ''}${minutes}`;
        } else if (this.isDropdown) {
            const options = this._field.options ? this._field.options : this._field.values;
            this.options = dataFormatter.formatLabelAndValue(options);
            this.value == null ? this.value = '' : null;
            if (!this._field.isRequired) {
                const emptyOption = {
                    label: `--${this.labels.None}--`,
                    value: ''
                };
                this.options.unshift(emptyOption);
            }
        } else if (this.isMultiPicklist && !this.isReadonly) {
            let options = this._field.options ? this._field.options : this._field.values;
            this.options = dataFormatter.formatLabelAndValue(options);
            this.value == null ? this.value = '' : null;
            this.value = this.value.split(';');
        }
        if (this.isReadonly) {
            this.formatDisplayValue();
        }
        // DEPENDENT SPECIFIC
        if (this._field.isDependentMember) {
            this.isDependentMember = this._field.isDependentMember;
            if (this._field.fieldName == 'vlocity_ins__FirstName__c') {
                this._field.isRequired = false;
            } else if (this._field.fieldName == 'vlocity_ins__LastName__c') {
                this._field.isRequired = false;
            } else if (this._field.fieldName == 'Zip_Code__c') {
                this._field.isRequired = false;
                this.value = '';
            } 
        }
        // CATCHES
        if (this._field.fieldName == 'Relationship__c' && !this._field.isDependentMember) {
            this.isReadOnly = true;
            this.isDropdown = false;
            this.isRelationshipDropdown = true;
            this._field.isRequired = false;
        }
        
        if (this._field.fieldName == 'Relationship__c' && this._field.isDependentMember) {
            this.options = dependentOptions;
        }
    }

    @api dateFormat = 'MM/DD/YYYY';
    @api dateOutputFormat = 'MM/DD/YYYY';
    @api dateTimeDateFormat = 'MM/DD/YYYY';
    @api dateTimeOutputFormat = "MM/DD/YYYY HH:mm:ss";

    @track _field;
    @track value;
    @track options;

    // deprecated properties
    @api currencySymbol;
    labels = {
        None: 'None',
        Selected: 'Selected',
        InsProductAvailable: 'Available',
    };

    setBirthdateAttributes (data) {
        if (this.evaluateBirthdateAndAge(data.field, data.name).birthdateIsReadOnly) {
            this.isReadonly = true;
            this._field.isRequired = false;
        } else {
            this.isReadonly = false;
            this._field.isRequired = true;
        }
        this.evaluateOrElement(this._field);
    }

    setAgeAttributes (data) {
        if (this.evaluateBirthdateAndAge(data.field, data.name).ageIsReadOnly) {
            this.isReadonly = true;
            this._field.isRequired = false;
        } else {
            this.isReadonly = false;
            this._field.isRequired = true;
        }
        if (this._field.clearAge) {
            this._field.value = '';
            this.value = this._field.value;
        }
        this.evaluateOrElement(this._field);
    }

    evaluateBirthdateAndAge (field, fieldName) {
        let birthdateIsReadOnly = false;
        let ageIsReadOnly = false;
        switch (fieldName) {
            case 'birthdate':
                if (field.ageHasValue === null || field.ageHasValue === false)
                    birthdateIsReadOnly = false;
                else if (field.ageHasValue)
                    birthdateIsReadOnly = true;
                if (field.onlyAgePresent)
                    birthdateIsReadOnly = true;
                break;
            case 'age':
                if ((field.birthdateHasValue === null && field.ageHasValue === null && Number.isInteger(field.value)) || field.birthdateHasValue === true)
                    ageIsReadOnly = true;
                else if (field.birthdateHasValue === false || field.birthdateHasValue === null)
                    ageIsReadOnly = false;
                if (field.onlyAgePresent)
                    ageIsReadOnly = false;
                break;
            default:
                birthdateIsReadOnly = true;
                ageIsReadOnly = true;
                break;
        }
        return { birthdateIsReadOnly, ageIsReadOnly };
    }

    formatDisplayValue() {
        const field = {
            userValues: this.value,
            dataType: this._field.dataType.toLowerCase()
        };
        if (this.isDropdown) {
            field.inputType = 'dropdown';
            field.values = this.options;
        }
        else if (this.isMultiPicklist) {
            field.userValues = this.value.split(';').join(', ');
        }
        this.value = dataFormatter.formatDisplayValue(field, this.currency);
    }

    testDisableEnter (e) {
        if (e.keyIdentifier=='U+000A' || e.keyIdentifier=='Enter' || e.keyCode === 13) {
            if (e.target.nodeName=='INPUT'&&e.target.type=='text') {
                e.preventDefault();
                return false;
            }
        }
        return e.keyCode !== 13;
    }
  /* 
    handleValueChange_outofArea(e) {
        if (this.isCheckbox && this.field.fieldName == 'Out_of_Area__c')
        e.target.checked ? this.value = true: this.value = false;
    const payload = {
        fieldName: this.field.fieldName,
        value: this.value
    };
   

     let inputName = 'vlocity_ins-input';
        let value = this.isCheckbox ? e.target.checked : e.target.value;
        let isInvalid;
        this.value = value;
        const payload = {
            fieldName: this.field.fieldName,
            value,
            isInvalid
        };
         console.log('field name is '+this.field.fieldName);
        console.log('payload::'+JSON.stringify(payload));
        
        pubsub.fire(this.channel, 'changeFieldValue', payload);
    }*/
    //deepti
    handleValueChange(e) {
        let inputName = 'vlocity_ins-input';
        let value = this.isCheckbox ? e.target.checked : e.target.value;
        let isInvalid;
        this.value = value;
        
        if (this.isCurrency) {
            inputName = 'vlocity_ins-masked-input';
        } else if (this.isDropdown) {
            inputName = 'vlocity_ins-combobox';
            this.value === 'false' ? this.value = false : null;
        } else if (this.isMultiPicklist) {
            value = JSON.parse(JSON.stringify(e.detail.value)).join(';');
        } else if (this.isBirthDate) {
            this.value = this.value ? new Date(this._field.value) : null;
            // if date value not null then below logic adds 8 hours for fixing one day date decrement Issue 
            if (this.value != null) {
                var dt = new Date(this._field.value);
                dt.setHours(dt.getHours() + 10);
                this.value = dt;
            }
        }
        if (!this.isLookUp && !this.isMultiPicklist) {
            isInvalid = !this.template.querySelector(inputName).checkValidity();  // Determines if input value is formatted correctly
        }
        const payload = {
            fieldName: this.field.fieldName,
            value,
            isInvalid
        };
        //deepti
        console.log(this.field.fieldName);
        console.log('payload::'+JSON.stringify(payload));
        //deepti
        pubsub.fire(this.channel, 'changeFieldValue', payload);
        if ((this.isBirthDate || this.isAge) && !this.fromNcs)
            this.handleBirthdateAndAgeInputs(value, this.value, this.field.fieldName);
    }

    get labelStyles() {
        return `${this.theme}-form-element__label ${this.theme}-show_inline`;
    }

    handleCobraChange(event) {
        if (this.isToogle && this.field.fieldName == 'COBRA__c')
            event.target.checked ? this.value = 'Yes' : this.value = 'No';
        const payload = {
            fieldName: this.field.fieldName,
            value: this.value
        };
        pubsub.fire(this.channel, 'changeFieldValue', payload);
    }


    handleMedicareChange(event) {
        if (this.isToogle && this.field.fieldName == 'Medicare__c')
            event.target.checked ? this.value = 'Yes' : this.value = 'No';
        const payload = {
            fieldName: this.field.fieldName,
            value: this.value
        };
        pubsub.fire(this.channel, 'changeFieldValue', payload);
    }

    handleServiceAreaChange(event) {
        if (this.isToogle && this.field.fieldName == 'Working_outside_of_service_area__c')
            event.target.checked ? this.value = 'Yes' : this.value = 'No';
        const payload = {
            fieldName: this.field.fieldName,
            value: this.value
        };
        pubsub.fire(this.channel, 'changeFieldValue', payload);
    }

    handleBirthdateAndAgeInputs (value, thisValue, fieldName) {
        const payload = {
            fieldName: fieldName,
            value: value,
            globalFieldValue: thisValue
        };
        pubsub.fire(this.channel, 'changeBirthdayOrAge', payload);
    }

    evaluateOrElement (data) {
        if (
            (data.birthdateHasValue === false && data.ageHasValue === false) ||
            (data.birthdateHasValue === null  && data.ageHasValue === false) ||
            (data.birthdateHasValue === false && data.ageHasValue === null)  ||
            (data.birthdateHasValue === null  && data.ageHasValue === null && !data.value)
        )
            this.showOrElement = true;
        else
            this.showOrElement = false;
    }

    evalTextNum () {
        this.value = this.value.replace(/^[0-9]+/g, '');
    }
}