import SseDataWorkerServer from "./SseDataWorkerServer";
import configurationFile from "./config";
import {basename} from "path";
import {readFile} from "fs";
import * as THREE from 'three';
import SsePCDLoader from "../imports/editor/3d/SsePCDLoader";

WebApp.connectHandlers.use("/api/json", generateJson);
WebApp.connectHandlers.use("/api/pcdtext", generatePCDOutput.bind({fileMode: false}));
WebApp.connectHandlers.use("/api/pcdfile", generatePCDOutput.bind({fileMode: true}));
WebApp.connectHandlers.use("/api/listing", imagesListing);

const {imagesFolder, pointcloudsFolder, instancesFolder, setsOfClassesMap} = configurationFile;
new SsePCDLoader(THREE);

function imagesListing(req, res, next) {
    const all = SseSamples.find({}, {
        fields: {
            url: 1,
            folder: 1,
            file: 1,
            tags: 1,
            firstEditDate: 1,
            lastEditDate: 1
        }
    }).fetch();
    res.end(JSON.stringify(all, null, 1));
}

function generateJson(req, res, next) {
    res.setHeader('Content-Type', 'application/json');
    const item = SseSamples.findOne({url: req.url});
    if (item) {
        const soc = setsOfClassesMap.get(item.socName);
        item.objects.forEach(obj => {
            obj.label = soc.objects[obj.classIndex].label;
        });
        res.end(JSON.stringify(item, null, 1));
    }else{
        res.end("{}");
    }
}

function generatePCDOutput(req, res, next) {
    const pcdFile = imagesFolder + decodeURIComponent(req.url);
    const fileName = basename(pcdFile);
    const labelFile = pointcloudsFolder + decodeURIComponent(req.url) + ".labels";
    const objectFile = pointcloudsFolder + decodeURIComponent(req.url) + ".objects";

    if (this.fileMode) {
        res.setHeader('Content-disposition', 'attachment; filename=DOC'.replace("DOC", fileName));
        res.setHeader('Content-type', 'text/plain');
        res.charset = 'UTF-8';
    }


    readFile(pcdFile, (err, content) => {
        if (err) {
            res.end("Error while parsing PCD file.")
        }

        const loader = new THREE.PCDLoader(true);
        const pcdContent = loader.parse(content.buffer, "");
        const hasRgb = pcdContent.rgb.length > 0;
        const head = pcdContent.header;
        const rgb2int = rgb => rgb[2] + 256 * rgb[1] + 256 * 256 * rgb[0];

        let out = "VERSION .7\n";
        out += hasRgb ? "FIELDS x y z rgb label instance isgood\n" : "FIELDS x y z label instance isgood\n";
        out += hasRgb ? "SIZE 4 4 4 4 4 4 4\n" : "SIZE 4 4 4 4 4 4\n";
        out += hasRgb ? "TYPE F F F I I I I\n" : "TYPE F F F I I I\n";
        out += hasRgb ? "COUNT 1 1 1 1 1 1 1\n" : "COUNT 1 1 1 1 1 1\n";
        out += "WIDTH " + pcdContent.header.width + "\n";
        out += "HEIGHT " + pcdContent.header.height + "\n";
        out += "POINTS " + pcdContent.header.width*pcdContent.header.height + "\n";
        out += "VIEWPOINT " + head.viewpoint.tx;
        out += " " + head.viewpoint.ty;
        out += " " + head.viewpoint.tz;
        out += " " + head.viewpoint.qw;
        out += " " + head.viewpoint.qx;
        out += " " + head.viewpoint.qy;
        out += " " + head.viewpoint.qz + "\n";
        out += "DATA ascii\n";
        res.write(out);
        out = "";
        readFile(labelFile, (labelErr, labelContent) => {
            if (labelErr) {
                res.end("Error while parsing labels file.")
            }
            const labels = SseDataWorkerServer.uncompress(labelContent);

            readFile(objectFile, (objectErr, objectContent) => {
                let objectsAvailable = true;
                if (objectErr) {
                    objectsAvailable = false;
                }

                const objectByPointIndex = new Map();
                const isGoodByPointIndex = new Map();

                if (objectsAvailable) {
                    const objects = SseDataWorkerServer.uncompress(objectContent);
                    objects.forEach((obj, objIndex) => {
                        obj.points.forEach(ptIdx => {
                            objectByPointIndex.set(ptIdx, objIndex);
                            isGoodByPointIndex.set(ptIdx, obj.isGood);
                        })
                    });
                }
                let obj;

                pcdContent.position.forEach((v, i) => {
                    const position = Math.floor(i / 3);

                    switch (i % 3) {
                        case 0:
                            if (hasRgb) {
                                obj = {rgb: pcdContent.rgb[position], x: v};
                            }else{
                                obj = {x: v};
                            }
                            break;
                        case 1:
                            obj.y = v;
                            break;
                        case 2:
                            obj.z = v;
                            out += obj.x + " " + obj.y + " " + obj.z + " ";
                            if (hasRgb) {
                                out += rgb2int(obj.rgb) + " ";
                            }
                            out += labels[position] + " ";
                            const assignedObject = objectByPointIndex.get(position);
                            const isGoodSegment = isGoodByPointIndex.get(position);
                            if (assignedObject != undefined)
                                out += assignedObject + " " + isGoodSegment;
                            else
                                out += "-1 -1";
                            out += "\n";
                            res.write(out);
                            out = "";
                            break;
                    }
                });

                res.end()
            })
        });
    });
}
