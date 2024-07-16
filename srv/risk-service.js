const cds = require('@sap/cds')

module.exports = cds.service.impl(async function () {

    const { Risks, BusinessPartners, Items } = this.entities;

    this.on("getItemsWithQuantity", async ({ data: { quantity } }) => {
        return await SELECT.from(Items).where({ quantity });
    });

    this.before(["CREATE", "createItem"], (req) => {
        const { quantity } = req.data;
        if (quantity > 100) {
            return req.error(409, `Item quantity cannot be more than 100.`);
        }
    });

    this.on("createItem", async ({ data: { title, descr, quantity } }) => {
        await INSERT({ descr, title, quantity }).into(Items);
    });

    this.after("READ", Risks, (data) => {
        const risks = Array.isArray(data) ? data : [data];

        risks.forEach((risk) => {
            if (risk.impact >= 100000) {
                risk.criticality = 1;
            } else {
                risk.criticality = 2;
            }


            switch (risk.prio_code) {
                case 'H':
                    risk.PrioCriticality = 1;
                    break;
                case 'M':
                    risk.PrioCriticality = 2;
                    break;
                case 'L':
                    risk.PrioCriticality = 3;
                    break;
                default:
                    break;
            }

        })
    })

    // connect to remote service
    const BPsrv = await cds.connect.to("API_BUSINESS_PARTNER");

    /**
     * Event-handler for read-events on the BusinessPartners entity.
     * Each request to the API Business Hub requires the apikey in the header.
     */
    this.on("READ", BusinessPartners, async (req) => {
        // The API Sandbox returns alot of business partners with empty names.
        // We don't want them in our application
        req.query.where("LastName <> '' and FirstName <> '' ");

        return await BPsrv.transaction(req).send({
            query: req.query,
            headers: {
                apikey: process.env.apikey,
            },
        });

        
    });

    
    // Risks?$expand=bp (Expand on BusinessPartner)
    this.on("READ", Risks, async (req, next) => {

        /*
         Check whether the request wants an "expand" of the business partner
         As this is not possible, the risk entity and the business partner entity are in different systems (SAP BTP and S/4 HANA Cloud), 
         if there is such an expand, remove it
       */
        if (!req.query.SELECT.columns) return next();

        const expandIndex = req.query.SELECT.columns.findIndex(
            ({ expand, ref }) => expand && ref[0] === "bp"
        );

        if (expandIndex < 0) return next();

        // Remove expand from query
        req.query.SELECT.columns.splice(expandIndex, 1);

   // Make sure bp_BusinessPartner (ID) will be returned
   if (!req.query.SELECT.columns.find((column) => {
    if (column.ref) {
        column.ref.find((ref) => ref == "bp_BusinessPartner")
    }
}
)
) {
    req.query.SELECT.columns.push({ ref: ["bp_BusinessPartner"] });
}

        const risks = await next();

        const asArray = x => Array.isArray(x) ? x : [x];

        // Request all associated BusinessPartners
        const bpIDs = asArray(risks).map(risk => risk.bp_BusinessPartner);
        const busienssPartners = await BPsrv.transaction(req).send({
            query: SELECT.from(this.entities.BusinessPartners).where({ BusinessPartner: bpIDs }),
            headers: {
                apikey: process.env.apikey,
            }
        });

        // Convert in a map for easier lookup
        const bpMap = {};
        for (const businessPartner of busienssPartners)
            bpMap[businessPartner.BusinessPartner] = businessPartner;

        // Add BusinessPartners to result
        for (const note of asArray(risks)) {
            note.bp = bpMap[note.bp_BusinessPartner];
        }

        return risks;
    });

    const northwindSrv = await cds.connect.to("Northwind");
    this.on("getProducts", async (req) => {
        return await northwindSrv.send('GET', 'Products');
    });
    const serverSrv = await cds.connect.to("ExpressAPP");
    this.on("getFromExpress", async (req) => {
        return await serverSrv.send('GET', 'Products');
    });
     

});